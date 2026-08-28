import { parentPort, workerData } from 'node:worker_threads'
import sherpaOnnx from 'sherpa-onnx'

const { createOfflineRecognizer } = sherpaOnnx
const engineConfig = workerData.engine === 'paraformer'
  ? { paraformer: { model: workerData.model }, modelType: 'paraformer' }
  : { senseVoice: { model: workerData.model, language: 'auto', useInverseTextNormalization: 1 } }

const recognizer = createOfflineRecognizer({
  modelConfig: { ...engineConfig, tokens: workerData.tokens, numThreads: 1, debug: 0, provider: 'cpu' },
})

parentPort.on('message', message => {
  const { id, audio } = message
  const stream = recognizer.createStream()
  try {
    stream.acceptWaveform(16000, new Float32Array(audio))
    recognizer.decode(stream)
    const result = recognizer.getResult(stream)
    const text = String(result?.text ?? '').replace(/<\|[^|>]+\|>/gu, '').trim()
    parentPort.postMessage({ id, ok: true, text })
  } catch {
    parentPort.postMessage({ id, ok: false, error: 'transcription-failed' })
  } finally {
    stream.free()
  }
})

parentPort.on('close', () => {
  try { recognizer.free() } catch {}
})
