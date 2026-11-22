import { useEffect, useRef, useState } from 'react'
import { randomUUID } from 'expo-crypto'
import { ScrollView, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type { RpcClient } from '../../godbot/link/index.ts'
import { toBase64Url } from '../../godbot/link/index.ts'
import { Action } from './Action.tsx'
import { machineError } from './model.ts'
import { t } from '../ui/i18n.ts'
import { useMachinePalette } from './appearance.ts'

const URI = 'file:///android_asset/machine/terminal.html'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function encode(text: string): string {
  const data = toBase64Url(new TextEncoder().encode(text)).replace(/-/g, '+').replace(/_/g, '/')
  return data.padEnd(Math.ceil(data.length / 4) * 4, '=')
}
interface Output {
  cursor: number
  data: string
  truncated?: boolean
  exited?: boolean
  exitCode?: number | null
}
export function MachineTerminal({
  client,
  sessionId,
  onEnd,
  onExit,
}: {
  client: RpcClient
  sessionId: string
  onEnd: (message: string) => void
  onExit: (code: number | null) => void
}) {
  const p = useMachinePalette()
  const browser = useRef<WebView<object>>(null)
  const controller = useRef(new AbortController())
  const started = useRef(false)
  const [nonce] = useState(randomUUID)
  const [ready, setReady] = useState(false)
  const exited = useRef(false)
  const [finished, setFinished] = useState(false)
  const writer = useRef<Promise<void>>(Promise.resolve())
  const next = useRef(1)
  const queued = useRef(0)
  const ack = useRef<{ id: number; done: () => void } | null>(null)
  const [modifier, setModifier] = useState<string | null>(null)
  const [atEnd, setAtEnd] = useState(true)
  const live = () => !controller.current.signal.aborted
  const inject = (expr: string) => browser.current?.injectJavaScript('window.godbotTerminal?.' + expr + ';true')
  const fail = (e: unknown) => {
    if (!exited.current && live()) {
      controller.current.abort()
      onEnd(machineError(e))
    }
  }
  async function begin(cols: number, rows: number) {
    if (started.current) return
    started.current = true
    const signal = controller.current.signal
    try {
      await client.rpc('terminal.open', { sessionId, cols, rows }, { signal })
      if (live()) setReady(true)
      let cursor = 0
      while (!signal.aborted) {
        const out = await client.rpc<Output>(
          'terminal.read',
          { sessionId, cursor, waitMs: 1000 },
          { signal, timeoutMs: 5000 },
        )
        if (signal.aborted) return
        if (out.truncated) inject('mark(' + JSON.stringify(t('Earlier output was truncated')) + ')')
        if (out.data) {
          const painted = new Promise<void>((resolve) => {
            ack.current = { id: out.cursor, done: resolve }
          })
          inject('receive(' + JSON.stringify(out.data) + ',' + out.cursor + ')')
          await painted
          if (!live()) return
        }
        cursor = out.cursor
        if (out.exited || typeof out.exitCode === 'number') {
          exited.current = true
          setFinished(true)
          inject('end()')
          onExit(out.exitCode ?? null)
          return
        }
        if (!out.data) await wait(30)
      }
    } catch (e) {
      fail(e)
    }
  }
  function write(text: string) {
    if (exited.current || !live() || !started.current || text.length === 0) return
    if (queued.current + text.length > 128 * 1024) {
      fail(new Error('Terminal input queue is full'))
      return
    }
    // Split by Unicode scalar before encoding so paste cannot split UTF-8 characters.
    const chars = Array.from(text)
    for (let i = 0; i < chars.length; i += 2048) {
      const chunk = chars.slice(i, i + 2048).join('')
      queued.current += chunk.length
      const data = encode(chunk),
        seq = next.current++
      writer.current = writer.current
        .then(async () => {
          if (!live() || exited.current) return
          const request = { sessionId, seq, data },
            options = { signal: controller.current.signal, timeoutMs: 2500 }
          let result: { ack: number }
          try {
            result = await client.rpc('terminal.write', request, options)
          } catch (e) {
            if ((e as { code?: string }).code !== 'RPC_TIMEOUT' || !live()) throw e
            result = await client.rpc('terminal.write', request, options)
          }
          if (result.ack < seq) throw new Error('Terminal input was not acknowledged')
        })
        .catch(fail)
        .finally(() => {
          queued.current -= chunk.length
        })
    }
  }
  function onMessage(event: WebViewMessageEvent) {
    if (!live()) return
    let msg
    try {
      msg = JSON.parse(event.nativeEvent.data)
    } catch {
      return
    }
    // Android's modern WebMessageListener supplies an opaque origin for file assets.
    // Only the signed top-level document receives this per-view capability on load.
    if (msg?.nonce !== nonce) return
    switch (msg.type) {
      case 'ready':
        void begin(msg.cols, msg.rows)
        break
      case 'rendered':
        if (ack.current?.id === msg.id) {
          ack.current?.done()
          ack.current = null
        }
        break
      case 'input':
        if (typeof msg.data === 'string') write(msg.data)
        break
      case 'resize':
        if (started.current && !exited.current)
          void client
            .rpc(
              'terminal.resize',
              { sessionId, cols: msg.cols, rows: msg.rows },
              { signal: controller.current.signal },
            )
            .catch(fail)
        break
      case 'modifierConsumed':
        setModifier(null)
        break
      case 'scrolled':
        setAtEnd(msg.atEnd === true)
        break
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!started.current) fail(new Error('Could not initialize the terminal renderer'))
    }, 12000)
    return () => {
      clearTimeout(timer)
      controller.current.abort()
      ack.current?.done()
      ack.current = null
    }
  }, [])
  return (
    <View style={{ flex: 1, minHeight: 150, backgroundColor: '#171d1a', borderRadius: 12, overflow: 'hidden' }}>
      <WebView<object>
        ref={browser}
        style={{ flex: 1, backgroundColor: '#171d1a' }}
        source={{ uri: URI }}
        originWhitelist={['file://*']}
        onShouldStartLoadWithRequest={(nav) => nav.url === URI}
        onLoad={(e) => {
          if (e.nativeEvent.url === URI) inject('attach(' + JSON.stringify(nonce) + ')')
          else fail(new Error('Unexpected terminal document'))
        }}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        onRenderProcessGone={() => fail(new Error('Terminal renderer stopped'))}
        onError={() => fail(new Error('Could not load the terminal renderer'))}
      />
      {!ready && (
        <Text accessibilityLiveRegion="polite" style={{ color: '#e2e8de', padding: 8 }}>
          {t('Opening terminal…')}
        </Text>
      )}
      {!atEnd && <Action label="Jump to latest" onPress={() => inject('latest()')} />}
      {!finished && (
        <View style={{ backgroundColor: p.sidebar }}>
          <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 4, padding: 4 }}>
            {[
              ['Esc', '\x1b'],
              ['Tab', '\t'],
              ['Ctrl', ''],
              ['Alt', ''],
              ['←', '\x1b[D'],
              ['↑', '\x1b[A'],
              ['↓', '\x1b[B'],
              ['→', '\x1b[C'],
              ['Ctrl+C', '\x03'],
            ].map(([key, value]) => (
              <Action
                key={key}
                label={key}
                primary={modifier === key}
                onPress={() => {
                  if (!value) {
                    const m = modifier === key ? null : key
                    setModifier(m)
                    inject('modifier(' + JSON.stringify(m) + ')')
                  } else {
                    write(value)
                    setModifier(null)
                    inject('modifier(null)')
                  }
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}
