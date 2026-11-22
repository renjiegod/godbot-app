const { withDangerousMod, withProjectBuildGradle } = require('expo/config-plugins')
const { mkdir, copyFile } = require('node:fs/promises')
const { join } = require('node:path')

// Serve the terminal from the signed APK, including its renderer and font metrics.
module.exports = (config) => {
  // react-native-webrtc declares 155.+; use the AAR verified with this APK.
  const pinned = withProjectBuildGradle(config, (mod) => {
    const rule = "subprojects { configurations.configureEach { resolutionStrategy.force 'org.jitsi:webrtc:155.0.1' } }"
    if (!mod.modResults.contents.includes(rule)) mod.modResults.contents += '\n' + rule + '\n'
    return mod
  })
  return withDangerousMod(pinned, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.projectRoot
      const dest = join(cfg.modRequest.platformProjectRoot, 'app/src/main/assets/machine')
      await mkdir(dest, { recursive: true })
      const sources = {
        'terminal.html': 'src/machine/terminal.html',
        'terminal-keyboard.js': 'src/machine/terminal-keyboard.js',
        'xterm.js': 'node_modules/@xterm/xterm/lib/xterm.js',
        'xterm.css': 'node_modules/@xterm/xterm/css/xterm.css',
        'fit.js': 'node_modules/@xterm/addon-fit/lib/addon-fit.js',
      }
      for (const [name, source] of Object.entries(sources)) await copyFile(join(root, source), join(dest, name))
      const licenses = join(dest, 'licenses')
      await mkdir(licenses, { recursive: true })
      for (const name of ['react-native-webrtc', 'react-native-webview', '@xterm/xterm', '@xterm/addon-fit']) {
        await copyFile(join(root, 'node_modules', name, 'LICENSE'), join(licenses, name.replace('/', '-') + '.txt'))
      }
      return cfg
    },
  ])
}
