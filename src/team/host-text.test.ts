import assert from 'node:assert/strict'
import test from 'node:test'
import { hostText, setLang, t } from '../ui/i18n.ts'

test('an error the app cannot translate is shown exactly as the computer sent it', () => {
  setLang('zh')
  // Godbot writes some errors in Chinese; t() would put spaces between Han and Latin letters.
  const chinese = '只有 owner 才能把 Bot 绑定到沙箱账号'
  const unspaced = '只有owner才能把Bot绑定到沙箱账号'
  assert.equal(hostText(unspaced), unspaced)
  assert.equal(hostText(chinese), chinese)
  assert.notEqual(t(unspaced), unspaced)
  // An English message with no translation stays English; one Godbot's dictionary knows is translated.
  assert.equal(hostText('Sandbox e2e-box is not running (exit 137)'), 'Sandbox e2e-box is not running (exit 137)')
  assert.notEqual(hostText('This DeepSeek Harness cannot list folders'), 'This DeepSeek Harness cannot list folders')
  // One the app knows is translated.
  assert.equal(hostText('Update Godbot on the computer to use this phone.'), '请先更新电脑上的 Godbot，再用这台手机。')
  setLang('en')
  assert.equal(hostText(unspaced), unspaced)
  assert.equal(hostText('Update Godbot on the computer to use this phone.'), 'Update Godbot on the computer to use this phone.')
})
