import assert from 'node:assert/strict'
import test from 'node:test'
import { concatFloat32, resampleTo16k, rms } from '../src/recorder.js'
import { appendTranscript } from '../src/draft.js'

test('resampling keeps duration and finite samples', () => {
  const input = new Float32Array(48000)
  for (let index = 0; index < input.length; index++) input[index] = Math.sin(index / 20)
  const output = resampleTo16k(input, 48000)
  assert.equal(output.length, 16000)
  assert.ok(output.every(Number.isFinite))
})

test('chunk concatenation and RMS are deterministic', () => {
  assert.deepEqual([...concatFloat32([new Float32Array([1, 2]), new Float32Array([3])])], [1, 2, 3])
  assert.equal(rms(new Float32Array([1, -1])), 1)
})

test('transcript appends naturally without submitting', () => {
  assert.equal(appendTranscript('', 'hello'), 'hello')
  assert.equal(appendTranscript('hello', 'world'), 'hello world')
  assert.equal(appendTranscript('你好', '世界'), '你好世界')
  assert.equal(appendTranscript('你好 ', 'world'), '你好world')
})

test('local recorder waits for an explicit stop instead of ending on a short pause', async () => {
  const source = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/recorder.js', import.meta.url), 'utf8'))
  assert.doesNotMatch(source, /END_SILENCE_MS/u)
  assert.match(source, /CALIBRATION_MS = 300/u)
  assert.match(source, /VOICE_STREAK_CHUNKS = 4/u)
})
