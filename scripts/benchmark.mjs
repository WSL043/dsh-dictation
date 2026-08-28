import { performance } from 'node:perf_hooks'
import { join } from 'node:path'
import sherpaOnnx from 'sherpa-onnx'

const modelRoot = process.argv[2]
if (!modelRoot) throw new Error('Usage: node scripts/benchmark.mjs <model-root>')

const mb = bytes => Math.round(bytes / 1024 / 1024 * 10) / 10
const memory = () => {
  const value = process.memoryUsage()
  return { rssMB: mb(value.rss), externalMB: mb(value.external), arrayBuffersMB: mb(value.arrayBuffers) }
}

const before = memory()
const loadStarted = performance.now()
const recognizer = sherpaOnnx.createOfflineRecognizer({
  modelConfig: {
    senseVoice: {
      model: join(modelRoot, 'model.int8.onnx'),
      language: 'auto',
      useInverseTextNormalization: 1,
    },
    tokens: join(modelRoot, 'tokens.txt'),
    numThreads: 1,
    debug: 0,
    provider: 'cpu',
  },
})
const loaded = memory()
const stream = recognizer.createStream()
stream.acceptWaveform(16000, new Float32Array(16000 * 10))
const decodeStarted = performance.now()
recognizer.decode(stream)
const decoded = memory()
const text = recognizer.getResult(stream)?.text ?? ''
stream.free()
recognizer.free()

console.log(JSON.stringify({
  inputSeconds: 10,
  threads: 1,
  provider: 'cpu',
  loadMilliseconds: Math.round(decodeStarted - loadStarted),
  decodeMilliseconds: Math.round(performance.now() - decodeStarted),
  before,
  loaded,
  decoded,
  loadRssDeltaMB: Math.round((loaded.rssMB - before.rssMB) * 10) / 10,
  text,
}, null, 2))
