const TARGET_RATE = 16000
const PRE_ROLL_MS = 450
const CALIBRATION_MS = 300
const MAX_UTTERANCE_MS = 60000
const MIN_UTTERANCE_MS = 350
const VOICE_STREAK_CHUNKS = 4

export function rms(samples) {
  if (samples.length === 0) return 0
  let sum = 0
  for (const value of samples) sum += value * value
  return Math.sqrt(sum / samples.length)
}

export function concatFloat32(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

export function resampleTo16k(input, sourceRate) {
  if (sourceRate === TARGET_RATE) return input.slice()
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new TypeError('invalid-source-rate')
  const outputLength = Math.max(1, Math.floor(input.length * TARGET_RATE / sourceRate))
  const output = new Float32Array(outputLength)
  const ratio = sourceRate / TARGET_RATE
  for (let index = 0; index < outputLength; index++) {
    const start = index * ratio
    const end = Math.min(input.length, (index + 1) * ratio)
    const first = Math.floor(start)
    const last = Math.ceil(end)
    let total = 0
    let weight = 0
    for (let sourceIndex = first; sourceIndex < last; sourceIndex++) {
      const overlap = Math.max(0, Math.min(end, sourceIndex + 1) - Math.max(start, sourceIndex))
      if (overlap > 0 && sourceIndex < input.length) {
        total += input[sourceIndex] * overlap
        weight += overlap
      }
    }
    output[index] = weight > 0 ? total / weight : 0
  }
  return output
}

const WORKLET_SOURCE = `
class DshDictationCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.parts = []
    this.length = 0
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (!channel || channel.length === 0) return true
    this.parts.push(new Float32Array(channel))
    this.length += channel.length
    if (this.length >= 2048) {
      const output = new Float32Array(this.length)
      let offset = 0
      for (const part of this.parts) { output.set(part, offset); offset += part.length }
      this.parts = []
      this.length = 0
      this.port.postMessage(output, [output.buffer])
    }
    return true
  }
}
registerProcessor('dsh-dictation-capture', DshDictationCapture)
`

const createWorkletUrl = () => URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))

export function createRecorder({ onState = () => {}, onLevel = () => {}, onSegment = () => {}, onError = () => {} } = {}) {
  let state = 'idle'
  let stream
  let context
  let source
  let worklet
  let workletUrl
  let active = false
  let closing = false
  let speech = false
  let voiceStreak = 0
  let noiseFloor = 0.003
  let speechMs = 0
  let calibrationMs = 0
  let chunks = []
  let preRoll = []

  const setState = value => {
    state = value
    onState(value)
  }

  const teardown = async () => {
    active = false
    try { worklet?.disconnect() } catch {}
    try { source?.disconnect() } catch {}
    worklet = undefined
    source = undefined
    try { stream?.getTracks().forEach(track => track.stop()) } catch {}
    stream = undefined
    try { await context?.close() } catch {}
    context = undefined
    if (workletUrl !== undefined) URL.revokeObjectURL(workletUrl)
    workletUrl = undefined
  }

  const finish = async ({ discard = false } = {}) => {
    if (closing) return
    closing = true
    const sourceRate = context?.sampleRate ?? TARGET_RATE
    const captured = speech ? concatFloat32(chunks) : new Float32Array(0)
    await teardown()
    chunks = []
    preRoll = []
    speech = false
    voiceStreak = 0
    const durationMs = captured.length / sourceRate * 1000
    let failed = false
    if (!discard && durationMs >= MIN_UTTERANCE_MS) {
      setState('transcribing')
      try { await onSegment(resampleTo16k(captured, sourceRate)) } catch (error) { failed = true; onError(error) }
    }
    closing = false
    if (!failed) setState('idle')
  }

  const handleChunk = chunk => {
    if (!active || closing) return
    const level = rms(chunk)
    const durationMs = chunk.length / context.sampleRate * 1000
    onLevel(Math.min(1, level / 0.18))
    if (!speech) {
      noiseFloor = noiseFloor * 0.97 + Math.min(level, 0.02) * 0.03
      calibrationMs += durationMs
      const threshold = Math.max(0.015, noiseFloor * 3.8)
      voiceStreak = calibrationMs >= CALIBRATION_MS && level >= threshold ? voiceStreak + 1 : 0
      preRoll.push(chunk)
      let bufferedMs = preRoll.reduce((sum, part) => sum + part.length / context.sampleRate * 1000, 0)
      while (bufferedMs > PRE_ROLL_MS && preRoll.length > 1) {
        const removed = preRoll.shift()
        bufferedMs -= removed.length / context.sampleRate * 1000
      }
      if (voiceStreak >= VOICE_STREAK_CHUNKS) {
        speech = true
        chunks = [...preRoll]
        preRoll = []
        speechMs = chunks.reduce((sum, part) => sum + part.length / context.sampleRate * 1000, 0)
        setState('speech')
      }
      return
    }
    chunks.push(chunk)
    speechMs += durationMs
    if (speechMs >= MAX_UTTERANCE_MS) void finish()
  }

  const start = async () => {
    if (active || closing) return
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined' || typeof AudioWorkletNode === 'undefined') {
      throw new Error('unsupported-browser')
    }
    setState('requesting-microphone')
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      context = new AudioContext({ latencyHint: 'interactive' })
      await context.resume()
      workletUrl = createWorkletUrl()
      await context.audioWorklet.addModule(workletUrl)
      source = context.createMediaStreamSource(stream)
      worklet = new AudioWorkletNode(context, 'dsh-dictation-capture', { numberOfInputs: 1, numberOfOutputs: 0 })
      worklet.port.onmessage = event => handleChunk(new Float32Array(event.data))
      source.connect(worklet)
      active = true
      speech = false
      chunks = []
      preRoll = []
      speechMs = 0
      voiceStreak = 0
      calibrationMs = 0
      setState('listening')
    } catch (error) {
      await teardown()
      setState('idle')
      throw error
    }
  }

  return {
    get state() { return state },
    get active() { return active },
    start,
    stop: () => finish(),
    cancel: () => finish({ discard: true }),
  }
}
