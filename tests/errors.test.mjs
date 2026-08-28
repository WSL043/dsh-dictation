import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyDictationFailure } from '../src/errors.js'

test('microphone permission errors retain their DOMException name', () => {
  assert.equal(classifyDictationFailure(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })), 'denied')
  assert.equal(classifyDictationFailure(Object.assign(new Error('Requested device not found'), { name: 'NotFoundError' })), 'microphoneMissing')
  assert.equal(classifyDictationFailure(Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' })), 'microphoneBusy')
  assert.equal(classifyDictationFailure(new Error('not-allowed')), 'denied')
  assert.equal(classifyDictationFailure(new Error('audio-capture')), 'microphoneMissing')
  assert.equal(classifyDictationFailure(new Error('language-not-supported')), 'unsupported')
})

test('Codex handoff errors stay actionable', () => {
  assert.equal(classifyDictationFailure(new Error('codex-desktop-not-running')), 'codexNotRunning')
  assert.equal(classifyDictationFailure(new Error('codex-app-shortcut-not-global')), 'codexWrongShortcut')
  assert.equal(classifyDictationFailure(new Error('invalid-codex-hotkey')), 'codexHotkeyMissing')
})
