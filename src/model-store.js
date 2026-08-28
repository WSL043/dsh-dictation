import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'

const hf = (repository, revision, name) => `https://huggingface.co/${repository}/resolve/${revision}/${name}`

export const MODELS = Object.freeze({
  sensevoice: Object.freeze({
    id: 'sensevoice-small-int8-2024-07-17', engine: 'sensevoice', label: 'SenseVoice Small',
    detail: 'Mandarin, Cantonese, English, Japanese and Korean',
    repository: 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', revision: '2365baeacb507f821a0c8120fcee3d484dba7a07',
    files: Object.freeze([
      Object.freeze({ name: 'model.int8.onnx', size: 239233841, sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51' }),
      Object.freeze({ name: 'tokens.txt', size: 315894, sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc' }),
    ]),
  }),
  paraformer: Object.freeze({
    id: 'paraformer-zh-small-int8-2024-03-09', engine: 'paraformer', label: 'Paraformer Small',
    detail: 'Chinese and English; optimized for fast local recognition',
    repository: 'csukuangfj/sherpa-onnx-paraformer-zh-small-2024-03-09', revision: '63ddc3cd0f2810b68289a7b3876e62ef5d53d6df',
    files: Object.freeze([
      Object.freeze({ name: 'model.int8.onnx', size: 81828675, sha256: '3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec' }),
      Object.freeze({ name: 'tokens.txt', size: 75352, sha256: '4b2d964e18b9cf139b473003b6698fb2ed9a2a5ec55b93daa677b28f578897aa' }),
    ]),
  }),
  nemotron: Object.freeze({
    id: 'nemotron-3.5-asr-streaming-0.6b-q8', engine: 'nemotron', label: 'Nemotron 3.5 ASR',
    detail: '40 language locales with model-based automatic language detection',
    repository: 'nvidia/nemotron-3.5-asr-streaming-0.6b', revision: '1c8deaecc64b91f034d73e08dd8b64625eb3395d', platform: 'win32-x64',
    files: Object.freeze([
      Object.freeze({ name: 'nemotron-3.5-asr-streaming-0.6b.q8_0.gguf', size: 741548352, sha256: 'a5c435f294eea8f88ce68dd27b8c3bfea7f777cb2fbba04fcd30eaa555f429ae' }),
      Object.freeze({ name: 'nemo-speech-0.1.0-windows-x86_64-cpu.zip', size: 4730421, sha256: '5e4ea81046012edcd77fd8848de8eefb5a4ba38cc26f52eb544ab184695a75d6', url: 'https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.1.0/nemo-speech-0.1.0-windows-x86_64-cpu.zip' }),
    ]),
  }),
})

export const MODEL = MODELS.sensevoice
const manifestName = '.verified.json'
export const modelTotalBytes = Object.fromEntries(Object.entries(MODELS).map(([key, model]) => [key, model.files.reduce((sum, file) => sum + file.size, 0)]))

export function modelFor(id) {
  const model = MODELS[id]
  if (model === undefined) throw new Error('unknown-model')
  return model
}

const fileUrl = (model, file) => file.url ?? hf(model.repository, model.revision, file.name)

async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

async function validFile(path, file) {
  const info = await stat(path).catch(() => undefined)
  return info?.isFile() === true && info.size === file.size && await sha256(path) === file.sha256
}

export function modelPaths(root, id = 'sensevoice') {
  const model = modelFor(id)
  const directory = join(root, model.id)
  return {
    directory, model: join(directory, model.files[0].name),
    tokens: model.engine === 'nemotron' ? undefined : join(directory, 'tokens.txt'),
    archive: model.engine === 'nemotron' ? join(directory, model.files[1].name) : undefined,
    runtime: model.engine === 'nemotron' ? join(directory, 'runtime') : undefined,
    executable: model.engine === 'nemotron' ? join(directory, 'runtime', 'bin', 'nemo-speech.exe') : undefined,
    manifest: join(directory, manifestName),
  }
}

async function manifestMatches(root, id) {
  const model = modelFor(id)
  const paths = modelPaths(root, id)
  try {
    const value = JSON.parse(await readFile(paths.manifest, 'utf8'))
    if (value.id !== model.id || value.revision !== model.revision) return false
    for (const file of model.files) {
      const info = await stat(join(paths.directory, file.name))
      if (!info.isFile() || info.size !== file.size) return false
    }
    return true
  } catch { return false }
}

export async function inspectModel(root, id = 'sensevoice') {
  const model = modelFor(id)
  const totalBytes = modelTotalBytes[id]
  const paths = modelPaths(root, id)
  if (await manifestMatches(root, id) && (model.engine !== 'nemotron' || await nemotronRuntimeReady(paths))) return { id, ready: true, bytes: totalBytes, totalBytes }
  let bytes = 0
  for (const file of model.files) {
    const complete = await stat(join(paths.directory, file.name)).catch(() => undefined)
    if (complete?.isFile() && complete.size === file.size) { bytes += file.size; continue }
    const partial = await stat(join(paths.directory, `${file.name}.part`)).catch(() => undefined)
    bytes += Math.min(file.size, partial?.size ?? 0)
  }
  return { id, ready: false, bytes, totalBytes }
}

async function writeVerifiedManifest(root, id) {
  const model = modelFor(id)
  const paths = modelPaths(root, id)
  await writeFile(paths.manifest, `${JSON.stringify({ id: model.id, revision: model.revision, files: model.files.map(({ name, size, sha256: digest }) => ({ name, size, sha256: digest })) }, null, 2)}\n`, 'utf8')
}

async function downloadFile(root, id, file, completed, onProgress, signal) {
  const model = modelFor(id)
  const paths = modelPaths(root, id)
  const target = join(paths.directory, file.name)
  const part = `${target}.part`
  if (await validFile(target, file)) { onProgress(completed + file.size, modelTotalBytes[id], file.name); return }
  await rm(target, { force: true })
  await mkdir(dirname(part), { recursive: true })
  let offset = (await stat(part).catch(() => undefined))?.size ?? 0
  if (offset > file.size) { await rm(part, { force: true }); offset = 0 }
  const response = await fetch(fileUrl(model, file), { headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined, redirect: 'follow', signal })
  if (!response.ok || response.body === null) throw new Error(`model-download-${response.status}`)
  if (offset > 0 && response.status !== 206) { await rm(part, { force: true }); offset = 0 }
  const writer = createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' })
  let received = offset
  const reader = Readable.fromWeb(response.body)
  reader.on('data', chunk => { received += chunk.length; onProgress(completed + Math.min(received, file.size), modelTotalBytes[id], file.name) })
  await pipeline(reader, writer)
  const info = await stat(part)
  if (info.size !== file.size) throw new Error('model-download-size-mismatch')
  if (await sha256(part) !== file.sha256) { await rm(part, { force: true }); throw new Error('model-download-integrity-failed') }
  await rename(part, target)
  onProgress(completed + file.size, modelTotalBytes[id], file.name)
}

async function run(command, args, { env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolvePromise() : reject(new Error(stderr.trim() || stdout.trim() || `process-exited-${code}`)))
  })
}

async function nemotronRuntimeReady(paths) {
  const [executable, library] = await Promise.all([
    stat(paths.executable).catch(() => undefined),
    stat(join(paths.runtime, 'bin', 'nemo_speech_asr.dll')).catch(() => undefined),
  ])
  return executable?.isFile() === true && library?.isFile() === true
}

async function prepareNemotronRuntime(root) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('nemotron-platform-unsupported')
  const paths = modelPaths(root, 'nemotron')
  await rm(paths.runtime, { recursive: true, force: true })
  await mkdir(paths.runtime, { recursive: true })
  try {
    await run('tar.exe', ['-xf', paths.archive, '-C', paths.runtime])
  } catch {
    const script = "$ErrorActionPreference='Stop'; Import-Module Microsoft.PowerShell.Archive; Expand-Archive -LiteralPath $env:DSH_DICTATION_ARCHIVE -DestinationPath $env:DSH_DICTATION_RUNTIME -Force"
    const env = { ...process.env, DSH_DICTATION_ARCHIVE: paths.archive, DSH_DICTATION_RUNTIME: paths.runtime }
    delete env.PSModulePath
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env })
  }
  if (!await nemotronRuntimeReady(paths)) throw new Error('nemotron-runtime-invalid')
}

export async function ensureModel(root, id = 'sensevoice', { onProgress = () => {}, signal } = {}) {
  const model = modelFor(id)
  const paths = modelPaths(root, id)
  if (!await manifestMatches(root, id)) {
    await mkdir(paths.directory, { recursive: true })
    let completed = 0
    for (const file of model.files) { await downloadFile(root, id, file, completed, onProgress, signal); completed += file.size }
    await writeVerifiedManifest(root, id)
  }
  if (model.engine === 'nemotron' && !await nemotronRuntimeReady(paths)) await prepareNemotronRuntime(root)
  return paths
}

export async function verifyModel(root, id = 'sensevoice') {
  const model = modelFor(id)
  const paths = modelPaths(root, id)
  for (const file of model.files) if (!await validFile(join(paths.directory, file.name), file)) return false
  if (model.engine === 'nemotron' && !await nemotronRuntimeReady(paths)) return false
  await writeVerifiedManifest(root, id)
  return true
}

export async function removeModel(root, id) {
  const paths = modelPaths(root, id)
  const expectedRoot = `${resolve(root)}${sep}`
  if (!resolve(paths.directory).startsWith(expectedRoot)) throw new Error('unsafe-model-path')
  await rm(paths.directory, { recursive: true, force: true })
}
