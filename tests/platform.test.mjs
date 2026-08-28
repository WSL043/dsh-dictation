import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { parseGlobalHotkey, readCodexToggleHotkey } from '../src/platform.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'

test('desktop shortcut handoff uses a self-contained encoded PowerShell command', async () => {
  const source = await readFile(new URL('../src/platform.js', import.meta.url), 'utf8')
  assert.match(source, /-EncodedCommand/u)
  assert.match(source, /Buffer\.from\(script, 'utf16le'\)/u)
  assert.doesNotMatch(source, /'-Codes'/u)
})

test('Codex source uses the true global shortcut route and rejects the app-only shortcut', async () => {
  const client = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8')
  const host = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  assert.match(client, /handoff\/codex|codexHotkey|Codex global dictation/u)
  assert.match(host, /handoff\/codex|activateCodex/u)
  assert.deepEqual(parseGlobalHotkey('Ctrl+Alt+Space'), [0x11, 0x12, 0x20])
  assert.deepEqual(parseGlobalHotkey('Alt+F8'), [0x12, 0x77])
  assert.throws(() => parseGlobalHotkey('Ctrl+Shift+D'), /codex-app-shortcut-not-global/u)
  assert.throws(() => parseGlobalHotkey('Shift+D'), /invalid-codex-hotkey/u)
})

test('Codex toggle shortcut is read from current and legacy bounded global-state fields', async () => {
  const directory = await mkdtemp(join(os.tmpdir(), 'dsh-dictation-state-'))
  const path = join(directory, 'state.json')
  try {
    await writeFile(path, JSON.stringify({ globalDictationToggleHotkey: 'Ctrl+Alt+Space', unrelated: 'ignored' }))
    assert.equal(await readCodexToggleHotkey(path), 'Ctrl+Alt+Space')
    await writeFile(path, JSON.stringify({ 'electron-persisted-atom-state': { globalDictationToggleHotkey: 'Ctrl+Alt+Space', unrelated: 'ignored' } }))
    assert.equal(await readCodexToggleHotkey(path), 'Ctrl+Alt+Space')
    await writeFile(path, JSON.stringify({ 'electron-persisted-atom-state': { globalDictationToggleHotkey: 'Ctrl+Shift+D' } }))
    assert.equal(await readCodexToggleHotkey(path), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
