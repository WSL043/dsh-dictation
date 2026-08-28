import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { appendTranscript } from './draft.js'
import { classifyDictationFailure } from './errors.js'
import { createRecorder } from './recorder.js'

export const name = 'dsh-dictation'
export const inject = ['locale', 'slots']

const SLOT = 'conversation.input.right'
const SETTINGS_SLOT = 'settings.section'
const API = '/dsh-dictation-api'
const STORAGE = 'dsh-dictation.preferences.v2'
const CONFIG_EVENT = 'dsh-dictation-config'
const SOURCES = ['sensevoice', 'paraformer', 'nemotron', 'codex']
const LOCAL_SOURCES = new Set(['sensevoice', 'paraformer', 'nemotron'])
const DEFAULT_CONFIG = Object.freeze({ source: 'sensevoice', codexHotkey: '' })

const LOCALES = {
  en: {
    nav: 'Dictation', title: 'Voice input', intro: 'Choose how speech becomes an editable draft. Dictation never sends the message.',
    sourceTitle: 'Recognition source', sourceDescription: 'The composer keeps one microphone; the selected engine changes behind it.',
    modelsTitle: 'Local models', modelsDescription: 'Models are downloaded only when you choose Download and can be removed at any time.',
    environmentTitle: 'Codex Desktop', environmentDescription: 'Optional integration for the Codex global dictation shortcut.',
    sensevoice: 'SenseVoice', sensevoiceDetail: 'Local · 228 MB · balanced support for Chinese, English, Japanese, Korean and Cantonese',
    paraformer: 'Paraformer', paraformerDetail: 'Local · 78 MB · fastest for Mandarin and English; not intended for other languages',
    nemotron: 'Nemotron 3.5', nemotronDetail: 'Local · 712 MB · multilingual auto detection with the highest resource use',
    codex: 'Codex global dictation (Beta)', codexDetail: 'Uses the real system-wide Codex dictation shortcut and writes back to the DSH draft',
    download: 'Download', remove: 'Remove', cancelDownload: 'Cancel', installed: 'Installed', missing: 'Not installed',
    downloadingModel: 'Downloading {progress}%', failedModel: 'Could not prepare this model', unsupportedModel: 'Not available on this platform',
    codexHotkey: 'Codex toggle-dictation shortcut', codexHotkeyHelp: 'The Codex shortcut is detected automatically. Use this field only as an override. Ctrl+Shift+D is only Codex in-app dictation and is not valid here.',
    codexConfigured: 'Codex Desktop is running. Detected global toggle shortcut: {hotkey}.',
    codexDetected: 'Codex Desktop is running, but no global toggle-dictation shortcut is configured yet.',
    codexNotDetected: 'Codex Desktop is not running.',
    lightweight: 'The plugin package contains no speech model. Audio stays local for downloaded models.',
    idle: 'Dictate', listening: 'Listening · click again to stop', speech: 'Listening · click again to stop', transcribing: 'Transcribing…',
    denied: 'Microphone access was not granted.', microphoneMissing: 'No microphone was found.', microphoneBusy: 'The microphone is unavailable or already in use.', localRecognitionFailed: 'The local recognition engine could not start. Check the selected model in Settings → Dictation.', failed: 'Dictation failed. Try again.', unsupported: 'This source is not available here.',
    modelMissing: 'Download the selected model in Settings → Dictation first.',
    codexHotkeyMissing: 'Configure the Codex global toggle shortcut in Settings → Dictation first.',
    codexNotRunning: 'Codex Desktop is not running.', codexWrongShortcut: 'Ctrl+Shift+D is Codex in-app dictation, not Global Dictation.',
    cancel: 'Cancel dictation', stop: 'Stop dictation', shortcut: 'Dictate · Ctrl+Shift+D', handoff: 'Opening desktop dictation…',
    codexListening: 'Codex is listening · click again to stop', codexFinishing: 'Codex is writing the transcript into the draft…',
  },
  zh: {
    nav: '语音输入', title: '语音输入', intro: '选择语音转为可编辑草稿的方式；插件不会自动发送消息。',
    sourceTitle: '识别来源', sourceDescription: '输入框始终只保留一个麦克风，设置决定它背后使用的引擎。',
    modelsTitle: '本地模型', modelsDescription: '只有点击下载时才获取模型，之后可随时卸载或切换。',
    environmentTitle: 'Codex Desktop', environmentDescription: '可选接入 Codex 全局听写快捷键。',
    sensevoice: 'SenseVoice', sensevoiceDetail: '本地 · 228 MB · 中英日韩粤较均衡',
    paraformer: 'Paraformer', paraformerDetail: '本地 · 78 MB · 普通话和英语最快，其他语言不适用',
    nemotron: 'Nemotron 3.5', nemotronDetail: '本地 · 712 MB · 多语种自动识别，资源占用最高',
    codex: 'Codex 全局听写（Beta）', codexDetail: '调用 Codex 真正的系统级听写快捷键，并把结果回填到 DSH 草稿',
    download: '下载', remove: '卸载', cancelDownload: '取消', installed: '已安装', missing: '未安装',
    downloadingModel: '正在下载 {progress}%', failedModel: '模型准备失败', unsupportedModel: '当前平台不可用',
    codexHotkey: 'Codex 切换听写快捷键', codexHotkeyHelp: '插件会自动检测 Codex 中已配置的快捷键；这里只用于手动覆盖。Ctrl+Shift+D 只是 Codex 窗口内听写，不能用于这里。',
    codexConfigured: 'Codex Desktop 正在运行，已检测到全局切换快捷键：{hotkey}。',
    codexDetected: 'Codex Desktop 正在运行，但尚未配置全局切换听写快捷键。',
    codexNotDetected: 'Codex Desktop 未运行。',
    lightweight: '插件包不包含语音模型；已下载的本地模型不会把音频上传。',
    idle: '语音输入', listening: '正在聆听 · 再点一次停止', speech: '正在聆听 · 再点一次停止', transcribing: '正在识别…',
    denied: '没有获得麦克风权限，请在当前 DSH 窗口允许麦克风。', microphoneMissing: '没有检测到可用麦克风。', microphoneBusy: '麦克风当前不可用，可能正被其他程序占用。', localRecognitionFailed: '本地识别引擎启动失败，请到设置 → 语音输入检查所选模型。', failed: '语音识别失败，请重试。', unsupported: '当前环境无法使用这个来源。',
    modelMissing: '请先到设置 → 语音输入下载所选模型。',
    codexHotkeyMissing: '请先到设置 → 语音输入填写 Codex 全局切换听写快捷键。',
    codexNotRunning: 'Codex Desktop 未运行。', codexWrongShortcut: 'Ctrl+Shift+D 是 Codex 窗口内听写，不是全局听写。',
    cancel: '取消语音输入', stop: '停止语音输入', shortcut: '语音输入 · Ctrl+Shift+D', handoff: '正在唤起桌面听写…',
    codexListening: 'Codex 正在聆听 · 再点一次停止', codexFinishing: 'Codex 正在把识别结果写入草稿…',
  },
}

const MicIcon = ({ size = 16 } = {}) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.25a2.25 2.25 0 0 0-2.25 2.25v3a2.25 2.25 0 0 0 4.5 0v-3A2.25 2.25 0 0 0 8 2.25Z" stroke="currentColor" strokeWidth="1.25"/><path d="M3.75 7.25v.5a4.25 4.25 0 0 0 8.5 0v-.5M8 12v2M5.75 14h4.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/></svg>

const CSS = `
.dd-wrap{position:relative;display:flex;align-items:center;flex:none;margin-right:-6px;transform:translateY(-2px)}
.dd-button{width:34px;height:34px;display:grid;place-items:center;padding:0;border:0;border-radius:999px;color:var(--dsw-alias-label-primary,rgba(255,255,255,.82));background:transparent;cursor:pointer;transition:background .15s ease,color .15s ease}
.dd-button:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,currentColor) 9%,transparent)}.dd-button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:2px}
.dd-button[data-active=true]{color:var(--dsw-alias-state-business-primary,#4f8cff);background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4f8cff) 12%,transparent)}.dd-button[data-active=true] svg{transform:scale(calc(1 + var(--dd-level,0) * .12));transition:transform 70ms linear}.dd-button:disabled{cursor:default;opacity:.72}
.dd-popover{position:absolute;right:0;bottom:38px;z-index:40;width:max-content;max-width:min(330px,calc(100vw - 28px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:12px;color:var(--dsw-alias-label-primary,currentColor);background:var(--dsw-alias-bg-layer-2,#242424);box-shadow:0 10px 28px rgba(0,0,0,.16);font:12px/1.45 system-ui,sans-serif}
.dd-status{display:flex;align-items:center;gap:8px}.dd-wave{height:14px;display:flex;align-items:center;gap:2px}.dd-wave i{display:block;width:2px;border-radius:2px;background:currentColor;animation:dd-wave .72s ease-in-out infinite alternate}.dd-wave i:nth-child(1){height:5px}.dd-wave i:nth-child(2){height:11px;animation-delay:-.3s}.dd-wave i:nth-child(3){height:7px;animation-delay:-.5s}.dd-wave i:nth-child(4){height:13px;animation-delay:-.18s}.dd-wave i:nth-child(5){height:6px;animation-delay:-.42s}.dd-error{color:var(--dsw-alias-state-error-primary,#e45252)}
button:has(.dd-nav)>svg:first-child{display:none}.dd-nav{display:inline-flex;align-items:center;gap:9px}.dd-settings{width:100%;max-width:920px;color:var(--dsw-alias-label-primary,currentColor);font:14px/1.5 system-ui,sans-serif}.dd-settings h2{font-size:18px;line-height:1.35;margin:0 0 5px}.dd-lead,.dd-section-head p,.dd-row-copy p,.dd-model-copy p,.dd-footnote{margin:0;color:var(--dsw-alias-label-secondary,#858b96);font-size:13px}.dd-section{padding:24px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}.dd-section:first-of-type{margin-top:22px}.dd-section-head{margin-bottom:14px}.dd-section-head h3{font-size:15px;margin:0 0 3px}.dd-source-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dd-source{display:flex;gap:11px;min-height:76px;padding:13px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:12px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;text-align:left;cursor:pointer}.dd-source[data-selected=true]{border-color:var(--dsw-alias-state-business-primary,#4f8cff);box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary,#4f8cff)}.dd-source-dot{width:16px;height:16px;margin-top:2px;border:1px solid var(--dsw-alias-border-l1,#8a8f99);border-radius:50%;display:grid;place-items:center;flex:none}.dd-source[data-selected=true] .dd-source-dot:after{content:'';width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-state-business-primary,#4f8cff)}.dd-source strong,.dd-model-copy strong{display:block;font-weight:600}.dd-source small{display:block;margin-top:3px;color:var(--dsw-alias-label-secondary,#858b96);font-size:12px;line-height:1.4}
.dd-model-list{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));border-radius:13px;overflow:hidden}.dd-model{display:flex;align-items:center;gap:14px;min-height:72px;padding:13px 15px}.dd-model+.dd-model{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}.dd-model-copy{min-width:0;flex:1}.dd-model-meta{font-size:12px;color:var(--dsw-alias-label-secondary,#858b96);white-space:nowrap}.dd-pill{height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:999px;background:transparent;color:inherit;cursor:pointer}.dd-pill:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,currentColor) 7%,transparent)}.dd-pill:disabled{opacity:.55;cursor:default}.dd-progress{height:3px;margin-top:8px;overflow:hidden;border-radius:99px;background:color-mix(in srgb,var(--dsw-alias-label-primary,currentColor) 13%,transparent)}.dd-progress i{display:block;height:100%;background:var(--dsw-alias-state-business-primary,#4f8cff)}
.dd-row{display:flex;align-items:center;gap:18px;min-height:64px;padding:8px 0}.dd-row+.dd-row{border-top:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.18))}.dd-row-copy{flex:1}.dd-input{width:min(230px,45vw);height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.28));border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit}.dd-cap{font-size:12px;color:var(--dsw-alias-label-secondary,#858b96)}.dd-footnote{margin-top:12px}
@keyframes dd-wave{from{transform:scaleY(.45);opacity:.6}to{transform:scaleY(1);opacity:1}}@media(max-width:620px){[role=dialog]:has(.dd-settings)>nav{display:none}[role=dialog]:has(.dd-settings)>:nth-child(2){width:100%;min-width:0;flex:1}.dd-settings{max-width:none}.dd-source-grid{grid-template-columns:1fr}.dd-row{align-items:flex-start;flex-direction:column;gap:8px}.dd-input{width:100%}.dd-model{align-items:flex-start;flex-wrap:wrap}.dd-model-copy{flex-basis:calc(100% - 30px)}.dd-model-meta{white-space:normal}}@media(prefers-reduced-motion:reduce){.dd-wave i{animation:none}}
.dd-source-body{min-width:0;flex:1}.dd-source-title{display:flex;align-items:center;justify-content:space-between;gap:10px}.dd-source-state{flex:none;color:var(--dsw-alias-label-secondary,#858b96);font-size:11px;font-weight:500}.dd-source-state[data-ready=true]{color:var(--dsw-alias-state-success-primary,#3fb950)}
`

function storedConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE) || '{}')
    const value = { source: SOURCES.includes(stored.source) ? stored.source : DEFAULT_CONFIG.source, codexHotkey: String(stored.codexHotkey ?? '') }
    if (/^ctrl\s*\+\s*shift\s*\+\s*d$/iu.test(String(value.codexHotkey ?? ''))) value.codexHotkey = ''
    return value
  } catch { return { ...DEFAULT_CONFIG } }
}

function setConfig(patch) {
  const value = { ...storedConfig(), ...patch }
  localStorage.setItem(STORAGE, JSON.stringify(value))
  window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: value }))
  return value
}

function useConfig() {
  const [config, update] = useState(storedConfig)
  useEffect(() => {
    const listener = event => update(event.detail ?? storedConfig())
    window.addEventListener(CONFIG_EVENT, listener)
    window.addEventListener('storage', listener)
    return () => { window.removeEventListener(CONFIG_EVENT, listener); window.removeEventListener('storage', listener) }
  }, [])
  return [config, patch => update(setConfig(patch))]
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { cache: 'no-store', ...options, headers: { 'x-dsh-dictation': '1', ...(options.headers ?? {}) } })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.error || 'request-failed')
  return value
}

const readStatus = () => fetch(`${API}/status`, { cache: 'no-store' }).then(response => response.ok ? response.json() : Promise.reject(new Error('status-failed')))
const transcribe = (source, samples) => request('/transcribe', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-dsh-dictation-engine': source }, body: samples.buffer })

function fill(text, values) { return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{${key}}`, String(value)), text) }
const size = bytes => `${Math.round(bytes / 1024 / 1024)} MB`

function SettingsNav({ t }) { return <span className="dd-nav"><MicIcon/><span>{t('nav')}</span></span> }

function DictationSettings({ t }) {
  const [config, update] = useConfig()
  const [status, setStatus] = useState({ models: [], capabilities: {} })
  const [busy, setBusy] = useState()
  const modelBySource = Object.fromEntries(status.models.map(model => [model.id, model]))
  const refresh = () => readStatus().then(setStatus).catch(() => undefined)
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const syncVisibleStatus = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const timer = setInterval(syncVisibleStatus, 2000)
    window.addEventListener('focus', syncVisibleStatus)
    document.addEventListener('visibilitychange', syncVisibleStatus)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', syncVisibleStatus)
      document.removeEventListener('visibilitychange', syncVisibleStatus)
    }
  }, [])
  useEffect(() => {
    if (!status.models.some(model => model.state === 'downloading')) return undefined
    const timer = setInterval(refresh, 350)
    return () => clearInterval(timer)
  }, [status])
  const operate = async (id, action) => {
    setBusy(`${id}:${action}`)
    if (action === 'prepare') setStatus(current => ({ ...current, models: current.models.map(model => model.id === id ? { ...model, state: 'downloading' } : model) }))
    try { await request(`/models/${id}/${action}`, { method: 'POST' }) } catch { /* Refreshed below with the bounded host error. */ } finally { setBusy(undefined); await refresh() }
  }
  return <div className="dd-settings">
    <h2>{t('title')}</h2><p className="dd-lead">{t('intro')}</p>
    <section className="dd-section"><div className="dd-section-head"><h3>{t('sourceTitle')}</h3><p>{t('sourceDescription')}</p></div>
      <div className="dd-source-grid">{SOURCES.map(source => {
        const model = modelBySource[source]
        const modelState = model?.state === 'ready' ? t('installed') : model?.state === 'unsupported' ? t('unsupportedModel') : model?.state === 'failed' ? t('failedModel') : model?.state === 'downloading' ? fill(t('downloadingModel'), { progress: Math.round((model.bytes || 0) / Math.max(1, model.totalBytes || 1) * 100) }) : model ? t('missing') : undefined
        return <button key={source} type="button" className="dd-source" data-selected={config.source === source} onClick={() => update({ source })}>
          <span className="dd-source-dot"/><span className="dd-source-body"><span className="dd-source-title"><strong>{t(source)}</strong>{modelState ? <span className="dd-source-state" data-ready={model?.state === 'ready'}>{modelState}</span> : null}</span><small>{t(`${source}Detail`)}</small></span>
        </button>
      })}</div>
    </section>
    <section className="dd-section"><div className="dd-section-head"><h3>{t('modelsTitle')}</h3><p>{t('modelsDescription')}</p></div>
      <div className="dd-model-list">{status.models.map(model => {
        const progress = Math.round((model.bytes || 0) / Math.max(1, model.totalBytes || 1) * 100)
        const downloading = model.state === 'downloading'
        const label = model.state === 'ready' ? t('installed') : model.state === 'unsupported' ? t('unsupportedModel') : downloading ? fill(t('downloadingModel'), { progress }) : model.state === 'failed' ? t('failedModel') : t('missing')
        return <div className="dd-model" key={model.id}><MicIcon/><div className="dd-model-copy"><strong>{t(model.id)}</strong><p>{t(`${model.id}Detail`)}</p>{downloading ? <div className="dd-progress"><i style={{ width: `${progress}%` }}/></div> : null}</div><span className="dd-model-meta">{label} · {size(model.totalBytes)}</span>
          {downloading ? <button className="dd-pill" type="button" onClick={() => operate(model.id, 'cancel')}>{t('cancelDownload')}</button> : model.state === 'ready' ? <button className="dd-pill" type="button" disabled={busy === `${model.id}:remove`} onClick={() => operate(model.id, 'remove')}>{t('remove')}</button> : model.state !== 'unsupported' ? <button className="dd-pill" type="button" disabled={busy === `${model.id}:prepare`} onClick={() => operate(model.id, 'prepare')}>{t('download')}</button> : null}
        </div>
      })}</div><p className="dd-footnote">{t('lightweight')}</p>
    </section>
    <section className="dd-section"><div className="dd-section-head"><h3>{t('environmentTitle')}</h3><p>{t('environmentDescription')}</p></div>
      <div className="dd-row"><div className="dd-row-copy"><strong>{t('codexHotkey')}</strong><p>{t('codexHotkeyHelp')}</p><p>{status.capabilities.codexToggleHotkey ? fill(t('codexConfigured'), { hotkey: status.capabilities.codexToggleHotkey }) : status.capabilities.codexDesktopRunning ? t('codexDetected') : t('codexNotDetected')}</p></div><input className="dd-input" value={config.codexHotkey} placeholder={status.capabilities.codexToggleHotkey || 'Ctrl+Alt+Space'} onChange={event => update({ codexHotkey: event.target.value })}/></div>
    </section>
  </div>
}

function DictationButton({ useInput, inputActions, t }) {
  const [portalTarget, setPortalTarget] = useState()
  const [config] = useConfig()
  const configRef = useRef(config)
  const [status, setStatus] = useState({ models: [], capabilities: {} })
  const [state, setState] = useState('checking')
  const [message, setMessage] = useState()
  const [level, setLevel] = useState(0)
  const draft = useInput ? useInput(value => value?.draft) : ''
  const draftRef = useRef(draft ?? '')
  const actionsRef = useRef(inputActions)
  const localRef = useRef()
  const epochRef = useRef(0)
  const codexActiveRef = useRef(false)
  const codexHotkeyRef = useRef('')
  const codexDraftRef = useRef('')
  const codexFinishTimerRef = useRef()
  useEffect(() => { configRef.current = config }, [config])
  useEffect(() => { draftRef.current = draft ?? '' }, [draft])
  useEffect(() => { actionsRef.current = inputActions }, [inputActions])

  const append = text => {
    if (!text || typeof actionsRef.current?.setDraft !== 'function') return
    const next = appendTranscript(draftRef.current, text)
    draftRef.current = next
    actionsRef.current.setDraft(next)
  }

  const focusComposer = () => {
    const slot = document.querySelector(`[data-slot="${SLOT}"]`)
    const editor = slot?.closest('[data-composer-card="true"]')?.querySelector('textarea:not([disabled]),[contenteditable="true"]')
    if (!(editor instanceof HTMLElement)) return false
    editor.focus({ preventScroll: true })
    return document.activeElement === editor
  }

  useLayoutEffect(() => {
    const slot = document.querySelector('[data-slot="conversation.input.right"]')
    const trailing = slot?.parentElement
    if (!slot || !trailing) return undefined
    const target = document.createElement('div')
    target.className = 'dd-wrap'
    target.dataset.dshDictationPortal = 'true'
    const place = () => {
      const candidates = [...trailing.children].filter(child => child !== target)
      const primary = candidates.reverse().find(child => {
        const button = child.matches('button') ? child : child.querySelector(':scope > button')
        if (!(button instanceof HTMLElement)) return false
        const style = getComputedStyle(button)
        const width = Number.parseFloat(style.width)
        const height = Number.parseFloat(style.height)
        return width >= 33 && width <= 35 && height >= 33 && height <= 35
      }) ?? candidates[0]
      if (primary && target.nextElementSibling !== primary) trailing.insertBefore(target, primary)
    }
    place()
    const observer = new MutationObserver(place)
    observer.observe(trailing, { childList: true })
    setPortalTarget(target)
    return () => { observer.disconnect(); setPortalTarget(undefined); target.remove() }
  }, [])

  useEffect(() => {
    let disposed = false
    const local = createRecorder({
      onState: next => { if (!disposed) { if (['idle', 'transcribing'].includes(next)) setLevel(0); setState(next) } },
      onLevel: next => { if (!disposed) setLevel(next) },
      onSegment: async samples => {
        const current = epochRef.current
        const value = await transcribe(configRef.current.source, samples)
        if (current === epochRef.current) append(String(value.text ?? '').trim())
      },
      onError: failure => { if (!disposed) { setMessage(classifyDictationFailure(failure)); setState('failed') } },
    })
    localRef.current = local
    void readStatus().then(value => { if (!disposed) { setStatus(value); setState('idle') } }).catch(() => { if (!disposed) setState('failed') })
    return () => {
      disposed = true
      epochRef.current++
      clearTimeout(codexFinishTimerRef.current)
      void local.cancel()
      if (codexActiveRef.current && codexHotkeyRef.current) {
        codexActiveRef.current = false
        void request('/handoff/codex', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hotkey: codexHotkeyRef.current }) }).catch(() => undefined)
      }
    }
  }, [])

  useEffect(() => {
    epochRef.current++
    void localRef.current?.cancel()
    setMessage(undefined)
    if (codexActiveRef.current && config.source !== 'codex' && codexHotkeyRef.current) {
      const hotkey = codexHotkeyRef.current
      codexActiveRef.current = false
      focusComposer()
      setState('handoff')
      void request('/handoff/codex', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hotkey }) })
        .then(() => setState('idle'))
        .catch(failure => { setMessage(classifyDictationFailure(failure)); setState('failed') })
    } else setState('idle')
  }, [config.source, config.codexHotkey])

  useEffect(() => {
    if (state !== 'codex-finishing' || String(draft ?? '') === codexDraftRef.current) return
    clearTimeout(codexFinishTimerRef.current)
    setState('idle')
  }, [draft, state])

  const toggleCodex = async () => {
    const current = configRef.current
    const latest = await readStatus()
    setStatus(latest)
    const hotkey = codexActiveRef.current
      ? codexHotkeyRef.current
      : current.codexHotkey.trim() || String(latest.capabilities?.codexToggleHotkey ?? '').trim()
    if (!hotkey) { setMessage('codexHotkeyMissing'); setState('failed'); return }
    focusComposer()
    setState('handoff')
    await request('/handoff/codex', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hotkey }) })
    if (codexActiveRef.current) {
      codexActiveRef.current = false
      codexDraftRef.current = String(draftRef.current ?? '')
      setState('codex-finishing')
      clearTimeout(codexFinishTimerRef.current)
      codexFinishTimerRef.current = setTimeout(() => setState('idle'), 5000)
    } else {
      codexHotkeyRef.current = hotkey
      codexActiveRef.current = true
      setState('codex-listening')
    }
  }

  const start = async () => {
    const current = configRef.current
    setMessage(undefined)
    if (LOCAL_SOURCES.has(current.source)) {
      const latest = await readStatus(); setStatus(latest)
      if (latest.models.find(model => model.id === current.source)?.state !== 'ready') { setMessage('modelMissing'); setState('failed'); return }
      await localRef.current?.start(); return
    }
    if (current.source === 'codex') { await toggleCodex(); return }
  }

  const toggle = async () => {
    try {
      if (localRef.current?.active) await localRef.current.stop()
      else if (!['transcribing', 'checking', 'handoff', 'codex-finishing'].includes(state)) await start()
    } catch (failure) {
      const messageKey = classifyDictationFailure(failure)
      setMessage(messageKey)
      setState(messageKey === 'denied' ? 'denied' : messageKey === 'unsupported' ? 'unsupported' : 'failed')
    }
  }

  useEffect(() => {
    const onKeyDown = event => {
      if (event.ctrlKey && event.shiftKey && event.code === 'KeyD' && !event.repeat) { event.preventDefault(); void toggle() }
      else if (event.key === 'Escape' && (localRef.current?.active || codexActiveRef.current)) {
        event.preventDefault()
        epochRef.current++
        if (codexActiveRef.current) void toggleCodex()
        else void localRef.current?.cancel()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const listening = ['requesting-microphone', 'listening', 'speech', 'codex-listening'].includes(state)
  const show = (listening && state !== 'codex-listening') || ['transcribing', 'handoff', 'codex-finishing', 'failed', 'denied', 'unsupported'].includes(state)
  const labelKey = message || (state === 'requesting-microphone' ? 'listening' : state === 'codex-listening' ? 'codexListening' : state === 'codex-finishing' ? 'codexFinishing' : state)
  if (!portalTarget) return null
  return createPortal(<>
    {show ? <div className={`dd-popover ${['failed', 'denied', 'unsupported'].includes(state) ? 'dd-error' : ''}`} role="status"><div className="dd-status">{listening ? <span className="dd-wave"><i/><i/><i/><i/><i/></span> : null}<span>{t(labelKey)}</span></div></div> : null}
    <button type="button" className="dd-button" style={{ '--dd-level': level }} data-active={listening} disabled={state === 'transcribing' || state === 'checking' || state === 'handoff' || state === 'codex-finishing'} onClick={() => void toggle()} aria-label={listening ? t('stop') : t('idle')} title={`${t('shortcut')} · ${t(config.source)}`}><MicIcon/></button>
  </>, portalTarget)
}

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(name, LOCALES), `${name}: dictionaries`)
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.plugin = name; style.textContent = CSS; document.head.appendChild(style); return () => style.remove() }, `${name}: styles`)
  const t = ctx.locale.bind(name)
  ctx.slots.inject(SETTINGS_SLOT, () => ctx.slots.register({ name: SETTINGS_SLOT, id: 'dictation', order: 27, label: () => <SettingsNav t={t}/> }, () => <DictationSettings t={t}/>))
  ctx.slots.inject(SLOT, () => ctx.slots.register({ name: SLOT, id: name, order: 36, locale: name, inject: () => ({ t }) }, DictationButton))
}

export { readStatus, setConfig, storedConfig, transcribe }
