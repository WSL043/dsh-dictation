import os from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { MODELS, ensureModel, inspectModel, modelFor, modelPaths, modelTotalBytes, removeModel, verifyModel } from './model-store.js'
import { activateCodexGlobalDictation, detectDesktopCapabilities, transcribeNemotron } from './platform.js'

export const name = 'dictation'
export const inject = ['webServer']
export const BASE_PATH = '/dsh-dictation-api'

const SAMPLE_RATE = 16000
const MAX_AUDIO_BYTES = SAMPLE_RATE * 4 * 35
const defaultModelRoot = () => process.env.DSH_HOME ? join(process.env.DSH_HOME, 'models', 'dsh-dictation') : join(os.homedir(), '.cache', 'dsh-dictation', 'models')

const sendJson = (res, status, value) => {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

const trustedMutation = req => req.headers['x-dsh-dictation'] === '1'

function isSilentPcm(samples) {
  let sum = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error('invalid-audio')
    sum += sample * sample
  }
  return Math.sqrt(sum / samples.length) < 0.001
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export function createDictationRuntime({ modelRoot = defaultModelRoot(), capabilities = detectDesktopCapabilities, activateCodex = activateCodexGlobalDictation } = {}) {
  const workers = new Map()
  const jobs = new Map()
  const verified = new Set()
  const preparations = new Map()
  let nextJob = 1
  let desktop = { codexDesktopRunning: false, codexToggleHotkey: null }
  let capabilitiesCheckedAt = 0
  const snapshots = Object.fromEntries(Object.keys(MODELS).map(id => [id, { id, state: 'checking', bytes: 0, totalBytes: modelTotalBytes[id] }]))
  const publish = (id, next) => { snapshots[id] = { ...snapshots[id], ...next } }

  const refreshCapabilities = async () => {
    if (Date.now() - capabilitiesCheckedAt < 2_000) return desktop
    capabilitiesCheckedAt = Date.now()
    desktop = await capabilities().catch(() => desktop)
    return desktop
  }

  const initialize = async () => {
    await refreshCapabilities()
    await Promise.all(Object.keys(MODELS).map(async id => {
      if (MODELS[id].platform && MODELS[id].platform !== `${process.platform}-${process.arch}`) {
        publish(id, { state: 'unsupported', error: 'platform-unsupported' }); return
      }
      const found = await inspectModel(modelRoot, id)
      publish(id, { state: found.ready ? 'ready' : 'missing', bytes: found.bytes, totalBytes: found.totalBytes, error: undefined })
    }))
  }
  void initialize().catch(() => undefined)

  const publicModel = id => ({
    ...snapshots[id], id, label: MODELS[id].label, detail: MODELS[id].detail, engine: MODELS[id].engine,
    local: true, platform: MODELS[id].platform,
  })
  const status = async () => ({ models: Object.keys(MODELS).map(publicModel), capabilities: await refreshCapabilities() })

  const prepare = async id => {
    modelFor(id)
    if (snapshots[id].state === 'unsupported') throw new Error('platform-unsupported')
    if (preparations.has(id)) return preparations.get(id).promise
    const controller = new AbortController()
    publish(id, { state: 'downloading', error: undefined })
    const promise = ensureModel(modelRoot, id, {
      signal: controller.signal,
      onProgress: (bytes, totalBytes, file) => publish(id, { state: 'downloading', bytes, totalBytes, file }),
    }).then(async () => {
      if (!await verifyModel(modelRoot, id)) throw new Error('model-integrity-failed')
      verified.add(id)
      publish(id, { state: 'ready', bytes: modelTotalBytes[id], totalBytes: modelTotalBytes[id], file: undefined, error: undefined })
      return publicModel(id)
    }).catch(error => {
      const code = error?.name === 'AbortError' ? 'download-cancelled' : String(error?.message || 'download-failed')
      publish(id, { state: code === 'download-cancelled' ? 'missing' : 'failed', file: undefined, error: code })
      throw error
    }).finally(() => preparations.delete(id))
    preparations.set(id, { controller, promise })
    return promise
  }

  const cancel = id => {
    modelFor(id)
    preparations.get(id)?.controller.abort()
  }

  const stopWorker = id => {
    const entry = workers.get(id)
    if (entry === undefined) return
    workers.delete(id)
    void entry.worker.terminate()
    for (const [jobId, job] of jobs) if (job.model === id) { jobs.delete(jobId); job.reject(new Error('transcription-worker-stopped')) }
  }

  const remove = async id => {
    modelFor(id)
    cancel(id)
    stopWorker(id)
    verified.delete(id)
    await removeModel(modelRoot, id)
    publish(id, { state: 'missing', bytes: 0, totalBytes: modelTotalBytes[id], file: undefined, error: undefined })
    return publicModel(id)
  }

  const getWorker = async id => {
    const existing = workers.get(id)
    if (existing !== undefined) return existing.worker
    if (snapshots[id].state !== 'ready') throw new Error('model-not-ready')
    if (!verified.has(id)) {
      publish(id, { state: 'checking', error: undefined })
      if (!await verifyModel(modelRoot, id)) { publish(id, { state: 'failed', error: 'model-integrity-failed' }); throw new Error('model-integrity-failed') }
      verified.add(id)
      publish(id, { state: 'ready', bytes: modelTotalBytes[id], totalBytes: modelTotalBytes[id], error: undefined })
    }
    const paths = modelPaths(modelRoot, id)
    const worker = new Worker(new URL('./recognizer-worker.js', import.meta.url), { type: 'module', workerData: { engine: MODELS[id].engine, model: paths.model, tokens: paths.tokens } })
    const failJobs = () => {
      workers.delete(id)
      for (const [jobId, job] of jobs) if (job.model === id) { jobs.delete(jobId); job.reject(new Error('transcription-worker-stopped')) }
    }
    worker.on('message', message => {
      const job = jobs.get(message.id)
      if (job === undefined) return
      jobs.delete(message.id)
      if (message.ok) job.resolve(message.text); else job.reject(new Error(message.error || 'transcription-failed'))
    })
    worker.once('error', failJobs)
    worker.once('exit', failJobs)
    workers.set(id, { worker })
    return worker
  }

  const transcribe = async (id, bytes) => {
    const model = modelFor(id)
    if (bytes.length === 0 || bytes.length % 4 !== 0) throw new Error('invalid-audio')
    const aligned = bytes.byteOffset % 4 === 0 ? bytes : Buffer.from(bytes)
    const audio = aligned.buffer.slice(aligned.byteOffset, aligned.byteOffset + aligned.byteLength)
    const samples = new Float32Array(audio)
    if (isSilentPcm(samples)) return ''
    if (model.engine === 'nemotron') {
      if (snapshots[id].state !== 'ready') throw new Error('model-not-ready')
      if (!verified.has(id) && !await verifyModel(modelRoot, id)) throw new Error('model-integrity-failed')
      verified.add(id)
      await ensureModel(modelRoot, id)
      return transcribeNemotron(samples, modelPaths(modelRoot, id))
    }
    const worker = await getWorker(id)
    const jobId = nextJob++
    return new Promise((resolve, reject) => { jobs.set(jobId, { model: id, resolve, reject }); worker.postMessage({ id: jobId, audio }, [audio]) })
  }

  const dispose = () => {
    for (const item of preparations.values()) item.controller.abort()
    for (const id of workers.keys()) stopWorker(id)
  }

  return { status, prepare, cancel, remove, transcribe, activateCodex, dispose }
}

export function createRequestHandler(runtime) {
  return async (req, res, suffix = '') => {
    const route = `/${String(suffix).replace(/^\/+/, '')}`
    if (req.method === 'GET' && route === '/status') { sendJson(res, 200, await runtime.status()); return }
    if (!trustedMutation(req)) { sendJson(res, 403, { error: 'forbidden' }); return }
    const modelMatch = route.match(/^\/models\/(sensevoice|paraformer|nemotron)\/(prepare|cancel|remove)$/u)
    if (req.method === 'POST' && modelMatch) {
      const [, id, action] = modelMatch
      try {
        const value = action === 'prepare' ? await runtime.prepare(id) : action === 'remove' ? await runtime.remove(id) : (runtime.cancel(id), { ok: true })
        sendJson(res, 200, value)
      } catch (error) { sendJson(res, 503, { error: String(error?.message || 'model-operation-failed') }) }
      return
    }
    if (req.method === 'POST' && route === '/transcribe') {
      const id = String(req.headers['x-dsh-dictation-engine'] ?? '')
      if (!MODELS[id]) { sendJson(res, 400, { error: 'unknown-model' }); return }
      try {
        const text = await runtime.transcribe(id, await readBody(req, MAX_AUDIO_BYTES))
        sendJson(res, 200, { text })
      } catch (error) {
        const message = String(error?.message || 'transcription-failed')
        sendJson(res, message === 'body-too-large' ? 413 : ['invalid-audio', 'unknown-model'].includes(message) ? 400 : message === 'model-not-ready' ? 409 : 500, { error: message })
      }
      return
    }
    if (req.method === 'POST' && route === '/handoff/codex') {
      try {
        const value = JSON.parse((await readBody(req, 512)).toString('utf8'))
        await runtime.activateCodex(value.hotkey)
        sendJson(res, 200, { ok: true })
      } catch (error) {
        const message = String(error?.message || 'handoff-failed')
        sendJson(res, ['invalid-codex-hotkey', 'codex-hotkey-not-configured', 'codex-app-shortcut-not-global'].includes(message) ? 400 : message === 'body-too-large' ? 413 : 503, { error: message })
      }
      return
    }
    sendJson(res, 404, { error: 'not-found' })
  }
}

export function apply(ctx) {
  const runtime = createDictationRuntime()
  const handler = createRequestHandler(runtime)
  ctx.effect(() => {
    const unregister = ctx.webServer.register({ kind: 'prefix', path: BASE_PATH, handler: (req, res) => {
      const url = new URL(req.url ?? BASE_PATH, 'http://localhost')
      void handler(req, res, url.pathname.slice(BASE_PATH.length))
    } })
    return () => { unregister?.(); runtime.dispose() }
  }, 'dsh-dictation: local transcription and operating-system handoff endpoints')
}

export { MODELS, MODEL, ensureModel, inspectModel, modelPaths, verifyModel } from './model-store.js'
