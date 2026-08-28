import { performance } from 'node:perf_hooks'
import { basename, join } from 'node:path'
import sherpaOnnx from 'sherpa-onnx'

const [modelRoot, ...waves] = process.argv.slice(2)
if (!modelRoot || waves.length === 0) throw new Error('Usage: node scripts/evaluate-paraformer.mjs <model-root> <wave...>')

const recognizer = sherpaOnnx.createOfflineRecognizer({
  modelConfig: {
    paraformer: { model: join(modelRoot, 'model.int8.onnx') },
    tokens: join(modelRoot, 'tokens.txt'),
    modelType: 'paraformer',
    numThreads: 1,
    debug: 0,
    provider: 'cpu',
  },
})

const results = []
for (const filename of waves) {
  const wave = sherpaOnnx.readWave(filename)
  const stream = recognizer.createStream()
  stream.acceptWaveform(wave.sampleRate, wave.samples)
  const started = performance.now()
  recognizer.decode(stream)
  const elapsedMilliseconds = performance.now() - started
  results.push({
    file: basename(filename),
    audioSeconds: Math.round(wave.samples.length / wave.sampleRate * 1000) / 1000,
    elapsedMilliseconds: Math.round(elapsedMilliseconds),
    realTimeFactor: Math.round(elapsedMilliseconds / 1000 / (wave.samples.length / wave.sampleRate) * 1000) / 1000,
    text: recognizer.getResult(stream)?.text ?? '',
  })
  stream.free()
}
recognizer.free()

console.log(JSON.stringify({ results, rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024 * 10) / 10 }, null, 2))
