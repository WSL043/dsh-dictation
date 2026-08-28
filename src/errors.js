export function classifyDictationFailure(failure) {
  const name = String(failure?.name ?? '')
  const message = String(failure?.message ?? failure ?? '')
  const detail = `${name} ${message}`

  if (/codex-desktop-not-running/iu.test(detail)) return 'codexNotRunning'
  if (/codex-app-shortcut-not-global/iu.test(detail)) return 'codexWrongShortcut'
  if (/codex-hotkey-not-configured|invalid-codex-hotkey/iu.test(detail)) return 'codexHotkeyMissing'
  if (/NotAllowedError|SecurityError|permission denied|permission dismissed|not-allowed|service-not-allowed/iu.test(detail)) return 'denied'
  if (/NotFoundError|DevicesNotFoundError|Requested device not found|no capture device|audio-capture/iu.test(detail)) return 'microphoneMissing'
  if (/NotReadableError|TrackStartError|Could not start audio source|device is in use/iu.test(detail)) return 'microphoneBusy'
  if (/unsupported-browser|not supported|language-not-supported/iu.test(detail)) return 'unsupported'
  if (/model-integrity-failed|transcription-worker-stopped|transcription-failed/iu.test(detail)) return 'localRecognitionFailed'
  return 'failed'
}
