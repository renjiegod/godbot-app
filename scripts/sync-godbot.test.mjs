import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { check, CLIENT_FILES, SHARED_FILES, sync } from './sync-godbot.mjs'

function fakeGodbot(root) {
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
  put('src/link/index.ts', "export * from './keys.ts'\n")
  put('src/link/keys.ts', 'export const k = 1\n')
  put('src/link/keys.test.ts', 'not copied\n')
  put('src/link/tsconfig.json', '{}\n')
  for (const [from] of [...CLIENT_FILES, ...SHARED_FILES]) put(from, `// ${from}\n`)
  put('src/client/team-ui/locales/ja.js', 'export default {}\n')
}

test('sync copies the shared files and records their hashes; check finds drift', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'godbot-sync-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const godbot = join(tmp, 'dsh-godbot')
  const app = join(tmp, 'app')
  fakeGodbot(godbot)
  mkdirSync(app)
  const env = { GODBOT_SRC: godbot }

  const { count, record } = sync(app, env)
  assert.equal(count, 2 + CLIENT_FILES.length + SHARED_FILES.length + 1)
  assert.equal(readFileSync(join(app, 'godbot/link/keys.ts'), 'utf8'), 'export const k = 1\n')
  assert.equal(readFileSync(join(app, 'godbot/client/team-ui/locales/ja.js'), 'utf8'), 'export default {}\n')
  assert.ok(record.files['link/index.ts'].match(/^[0-9a-f]{64}$/))
  assert.equal(record.files['link/keys.test.ts'], undefined)
  assert.deepEqual(JSON.parse(readFileSync(join(app, 'godbot/SOURCE.json'), 'utf8')).files, record.files)
  assert.deepEqual(check(app, env).problems, [])

  // A hand edit of a copy, and a change at the source, both show up.
  writeFileSync(join(app, 'godbot/shared/file-chunks.js'), '// edited\n')
  assert.deepEqual(check(app, env).problems, ['differs shared/file-chunks.js'])
  sync(app, env)
  writeFileSync(join(godbot, 'src/link/keys.ts'), 'export const k = 2\n')
  assert.deepEqual(check(app, env).problems, ['differs link/keys.ts'])
  sync(app, env)
  writeFileSync(join(app, 'godbot/link/extra.ts'), '')
  assert.deepEqual(check(app, env).problems, ['extra link/extra.ts'])
})

test('without a source checkout, check verifies the copies against SOURCE.json', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'godbot-sync-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const godbot = join(tmp, 'dsh-godbot')
  const app = join(tmp, 'app')
  fakeGodbot(godbot)
  mkdirSync(app)
  sync(app, { GODBOT_SRC: godbot })
  rmSync(godbot, { recursive: true, force: true })
  const none = { GODBOT_SRC: join(tmp, 'missing') }
  assert.deepEqual(check(app, none), { problems: [], against: 'record' })
  writeFileSync(join(app, 'godbot/link/keys.ts'), 'tampered\n')
  assert.deepEqual(check(app, none).problems, ['differs link/keys.ts'])
})

test('a checkout without the link sources is refused', (t) => {
  const tmp = mkdtempSync(join(tmpdir(), 'godbot-sync-'))
  t.after(() => rmSync(tmp, { recursive: true, force: true }))
  const godbot = join(tmp, 'dsh-godbot')
  fakeGodbot(godbot)
  rmSync(join(godbot, 'src/link'), { recursive: true })
  mkdirSync(join(tmp, 'app'))
  assert.throws(() => sync(join(tmp, 'app'), { GODBOT_SRC: godbot }), /no src\/link\/index\.ts/)
})
