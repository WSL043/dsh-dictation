import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { MODELS, modelTotalBytes } from '../src/model-store.js'

test('package supports the stable and reviewed preview DSH lanes', async () => {
  const [manifest, compatibility] = await Promise.all([
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../compatibility.json', import.meta.url), 'utf8').then(JSON.parse),
  ])
  const range = [...compatibility.supported, ...compatibility.previews].join(' || ')
  assert.equal(compatibility.latestTested, '0.1.1-rc.2')
  assert.deepEqual(compatibility.previews, ['0.1.2-alpha.2'])
  for (const [name, version] of Object.entries(manifest.peerDependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) assert.equal(version, range, name)
  }
})

test('every local model source is immutable and integrity pinned', () => {
  assert.deepEqual(Object.keys(MODELS), ['sensevoice', 'paraformer', 'nemotron'])
  for (const [id, model] of Object.entries(MODELS)) {
    assert.match(model.revision, /^[a-f0-9]{40}$/u)
    assert.equal(model.files.length, 2)
    assert.ok(model.files.every(file => /^[a-f0-9]{64}$/u.test(file.sha256) && file.size > 0))
    assert.equal(modelTotalBytes[id], model.files.reduce((sum, file) => sum + file.size, 0))
  }
})

test('client never submits a conversation automatically', async () => {
  const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.submit\s*\(/u)
  assert.doesNotMatch(source, /autoSend/u)
  assert.match(source, /setDraft/u)
})

test('plugin does not read subscription credentials or call OpenAI audio APIs', async () => {
  const files = await Promise.all(['../src/index.js', '../src/client.jsx'].map(path => readFile(new URL(path, import.meta.url), 'utf8')))
  const source = files.join('\n')
  assert.doesNotMatch(source, /OPENAI|credential|api\.openai\.com|auth\.openai\.com/iu)
})

test('composer microphone is ordered immediately before the primary action', async () => {
  const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8')
  assert.match(source, /querySelector\('\[data-slot="conversation\.input\.right"\]'\)/u)
  assert.match(source, /target\.dataset\.dshDictationPortal/u)
  assert.match(source, /candidates = \[\.\.\.trailing\.children\]\.filter\(child => child !== target\)/u)
  assert.match(source, /width >= 33 && width <= 35 && height >= 33 && height <= 35/u)
  assert.doesNotMatch(source, /const primary = trailing\.lastElementChild/u)
  assert.match(source, /trailing\.insertBefore\(target, primary\)/u)
  assert.match(source, /createPortal/u)
  assert.match(source, /\.dd-button\{width:34px;height:34px/u)
  assert.match(source, /margin-right:-6px/u)
  assert.match(source, /transform:translateY\(-2px\)/u)
})

test('dictation owns one native settings section and keeps models opt-in', async () => {
  const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8')
  assert.match(source, /const SETTINGS_SLOT = 'settings\.section'/u)
  assert.match(source, /<SettingsNav t=\{t\}\/>/u)
  assert.match(source, /\/models\/\$\{id\}\/\$\{action\}/u)
  assert.doesNotMatch(source, /prepare.*start\(\)/u)
})

test('public source selector is limited to three local models and Codex Desktop', async () => {
  const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8')
  assert.match(source, /const SOURCES = \['sensevoice', 'paraformer', 'nemotron', 'codex'\]/u)
  assert.doesNotMatch(source, /SpeechRecognition|webkitSpeechRecognition|browserLanguage|Browser speech|浏览器语音/u)
})

test('Codex global dictation restores the composer focus before invoking the desktop shortcut', async () => {
  const source = await readFile(new URL('../src/client.jsx', import.meta.url), 'utf8')
  assert.match(source, /closest\('\[data-composer-card="true"\]'\).*querySelector\('textarea/u)
  assert.match(source, /editor\.focus\(\{ preventScroll: true \}\)/u)
  assert.match(source, /focusComposer\(\).*handoff/su)
  assert.match(source, /codexActiveRef\.current.*codex-listening/su)
  assert.match(source, /codex-finishing/u)
  assert.doesNotMatch(source, /handoff\/windows|Windows voice typing|Windows 语音输入/u)
  assert.match(source, /classifyDictationFailure\(failure\)/u)
  assert.match(source, /value\.codexHotkey = ''/u)
})

test('Nemotron runtime preparation uses explicit environment paths and validates the extracted runtime', async () => {
  const source = await readFile(new URL('../src/model-store.js', import.meta.url), 'utf8')
  assert.match(source, /DSH_DICTATION_ARCHIVE/u)
  assert.match(source, /DSH_DICTATION_RUNTIME/u)
  assert.match(source, /run\('tar\.exe'/u)
  assert.match(source, /nemotronRuntimeReady/u)
  assert.doesNotMatch(source, /Expand-Archive -LiteralPath \$args\[0\]/u)
})
