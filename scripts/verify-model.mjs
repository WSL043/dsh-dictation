import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { createDictationRuntime } from '../src/index.js'
import { MODEL } from '../src/model-store.js'

function decodeWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'RIFF')
  let offset = 12
  let format
  let data
  while (offset + 8 <= bytes.length) {
    const id = Buffer.from(bytes.subarray(offset, offset + 4)).toString()
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    if (id === 'fmt ') format = {
      code: view.getUint16(start, true),
      channels: view.getUint16(start + 2, true),
      sampleRate: view.getUint32(start + 4, true),
      bits: view.getUint16(start + 14, true),
    }
    if (id === 'data') data = bytes.subarray(start, start + size)
    offset = start + size + (size % 2)
  }
  assert.ok(format && data)
  assert.equal(format.channels, 1)
  assert.equal(format.sampleRate, 16000)
  const samples = new Float32Array(data.length / (format.bits / 8))
  if (format.code === 1 && format.bits === 16) {
    const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let index = 0; index < samples.length; index++) samples[index] = pcm.getInt16(index * 2, true) / 32768
  } else if (format.code === 3 && format.bits === 32) {
    const pcm = new DataView(data.buffer, data.byteOffset, data.byteLength)
    for (let index = 0; index < samples.length; index++) samples[index] = pcm.getFloat32(index * 4, true)
  } else {
    throw new Error(`unsupported-wav-${format.code}-${format.bits}`)
  }
  return Buffer.from(samples.buffer)
}

const root = process.env.DSH_DICTATION_MODEL_ROOT || await mkdtemp(join(os.tmpdir(), 'dsh-dictation-model-'))
const runtime = createDictationRuntime({ modelRoot: root })
await runtime.prepare()

for (const language of ['zh', 'en']) {
  const url = `https://huggingface.co/${MODEL.repository}/resolve/${MODEL.revision}/test_wavs/${language}.wav`
  const response = await fetch(url)
  assert.equal(response.ok, true)
  const text = await runtime.transcribe(decodeWav(Buffer.from(await response.arrayBuffer())))
  assert.ok(text.length > 0)
  console.log(`${language}: ${text}`)
}

runtime.dispose()
