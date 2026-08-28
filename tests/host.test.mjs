import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { createDictationRuntime, createRequestHandler } from '../src/index.js'

const invoke = async ({ method = 'GET', route, headers = {}, body = Buffer.alloc(0), runtime }) => {
  const req = new PassThrough()
  req.method = method
  req.headers = headers
  const response = { statusCode: 0, headers: {}, body: '', setHeader(key, value) { this.headers[key] = value }, end(value = '') { this.body += value } }
  const promise = createRequestHandler(runtime)(req, response, route)
  req.end(body)
  await promise
  return { ...response, json: JSON.parse(response.body) }
}

test('status is readable but mutations require the same-origin guard header', async () => {
  const runtime = { status: () => ({ state: 'ready' }) }
  assert.equal((await invoke({ route: '/status', runtime })).statusCode, 200)
  assert.equal((await invoke({ method: 'POST', route: '/prepare', runtime })).statusCode, 403)
})

test('prepared PCM is returned as text', async () => {
  let received, engine
  const runtime = {
    status: () => ({ models: [{ id: 'sensevoice', state: 'ready' }] }),
    transcribe: async (id, body) => { engine = id; received = body; return 'hello' },
  }
  const body = Buffer.alloc(16)
  const result = await invoke({ method: 'POST', route: '/transcribe', headers: { 'x-dsh-dictation': '1', 'x-dsh-dictation-engine': 'sensevoice' }, body, runtime })
  assert.equal(result.statusCode, 200)
  assert.equal(result.json.text, 'hello')
  assert.equal(engine, 'sensevoice')
  assert.equal(received.length, 16)
})

test('transcription refuses a missing model', async () => {
  const runtime = { transcribe: async () => { throw new Error('model-not-ready') } }
  const result = await invoke({ method: 'POST', route: '/transcribe', headers: { 'x-dsh-dictation': '1', 'x-dsh-dictation-engine': 'sensevoice' }, runtime })
  assert.equal(result.statusCode, 409)
})

test('silent PCM is discarded before a recognizer can hallucinate text', async () => {
  const runtime = createDictationRuntime({ modelRoot: 'C:\\nonexistent-dsh-dictation-test-models', capabilities: async () => ({}) })
  assert.equal(await runtime.transcribe('paraformer', Buffer.alloc(64_000)), '')
  runtime.dispose()
})

test('model lifecycle routes remain guarded and bounded to known models', async () => {
  const calls = []
  const runtime = { prepare: async id => { calls.push(id); return { id, state: 'ready' } } }
  assert.equal((await invoke({ method: 'POST', route: '/models/sensevoice/prepare', runtime })).statusCode, 403)
  const result = await invoke({ method: 'POST', route: '/models/sensevoice/prepare', headers: { 'x-dsh-dictation': '1' }, runtime })
  assert.equal(result.statusCode, 200)
  assert.deepEqual(calls, ['sensevoice'])
  assert.equal((await invoke({ method: 'POST', route: '/models/other/prepare', headers: { 'x-dsh-dictation': '1' }, runtime })).statusCode, 404)
})

test('Codex handoff accepts only guarded bounded JSON and forwards the configured global shortcut', async () => {
  const calls = []
  const runtime = { activateCodex: async hotkey => calls.push(hotkey) }
  assert.equal((await invoke({ method: 'POST', route: '/handoff/codex', runtime })).statusCode, 403)
  const result = await invoke({ method: 'POST', route: '/handoff/codex', headers: { 'x-dsh-dictation': '1' }, body: Buffer.from(JSON.stringify({ hotkey: 'Ctrl+Alt+Space' })), runtime })
  assert.equal(result.statusCode, 200)
  assert.deepEqual(calls, ['Ctrl+Alt+Space'])
})
