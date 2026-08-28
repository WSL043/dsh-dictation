import { randomUUID } from 'node:crypto'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

function run(command, args, { env, maxOutput = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, env: env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const append = (current, chunk) => (current + chunk).slice(-maxOutput)
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk) })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim() || `process-exited-${code}`)))
  })
}

export async function readCodexToggleHotkey(path = join(os.homedir(), '.codex', '.codex-global-state.json')) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'))
    const hotkey = value?.globalDictationToggleHotkey
      ?? value?.['electron-persisted-atom-state']?.globalDictationToggleHotkey
    if (typeof hotkey !== 'string') return null
    parseGlobalHotkey(hotkey)
    return hotkey
  } catch {
    return null
  }
}

export async function detectDesktopCapabilities() {
  if (process.platform !== 'win32') return { codexDesktopRunning: false, codexToggleHotkey: null }
  const script = [
    "$codex=[bool](Get-Process 'ChatGPT' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -like '*OpenAI.Codex*' } catch { $false } } | Select-Object -First 1)",
    "[Console]::Out.Write((@{codex=$codex}|ConvertTo-Json -Compress))",
  ].join(';')
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxOutput: 4096 })
    const value = JSON.parse(stdout)
    const codexDesktopRunning = value.codex === true
    return { codexDesktopRunning, codexToggleHotkey: codexDesktopRunning ? await readCodexToggleHotkey() : null }
  } catch {
    return { codexDesktopRunning: false, codexToggleHotkey: null }
  }
}

const SEND_INPUT_SCRIPT = String.raw`
$sig='[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);'
$u=Add-Type -MemberDefinition $sig -Name DshDictationKeys -Namespace Native -PassThru
foreach($code in $Codes){$u::keybd_event([byte]$code,0,0,[UIntPtr]::Zero)}
for($i=$Codes.Length-1;$i-ge 0;$i--){$u::keybd_event([byte]$Codes[$i],0,2,[UIntPtr]::Zero)}
`

async function sendKeys(codes) {
  if (process.platform !== 'win32') throw new Error('windows-only')
  if (!Array.isArray(codes) || codes.length === 0 || codes.some(code => !Number.isInteger(code) || code < 0 || code > 255)) throw new Error('invalid-key-code')
  const script = `$Codes=@(${codes.join(',')})\n${SEND_INPUT_SCRIPT}`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { maxOutput: 4096 })
}

const MODIFIERS = Object.freeze({ ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5b, meta: 0x5b, super: 0x5b })
const NAMED_KEYS = Object.freeze({ space: 0x20, enter: 0x0d, tab: 0x09, escape: 0x1b, esc: 0x1b })

export function parseGlobalHotkey(value) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('codex-hotkey-not-configured')
  if (/^ctrl\s*\+\s*shift\s*\+\s*d$/iu.test(text)) throw new Error('codex-app-shortcut-not-global')
  const parts = text.split('+').map(part => part.trim().toLowerCase()).filter(Boolean)
  if (parts.length < 2 || new Set(parts).size !== parts.length) throw new Error('invalid-codex-hotkey')
  const modifiers = []
  let key
  for (const part of parts) {
    if (MODIFIERS[part] !== undefined) {
      if (!modifiers.includes(MODIFIERS[part])) modifiers.push(MODIFIERS[part])
      continue
    }
    if (key !== undefined) throw new Error('invalid-codex-hotkey')
    if (NAMED_KEYS[part] !== undefined) key = NAMED_KEYS[part]
    else if (/^[a-z0-9]$/u.test(part)) key = part.toUpperCase().charCodeAt(0)
    else {
      const functionKey = /^f(\d{1,2})$/u.exec(part)
      if (functionKey && Number(functionKey[1]) >= 1 && Number(functionKey[1]) <= 12) key = 0x70 + Number(functionKey[1]) - 1
      else throw new Error('invalid-codex-hotkey')
    }
  }
  if (key === undefined || !modifiers.some(code => code === 0x11 || code === 0x12)) throw new Error('invalid-codex-hotkey')
  return [...modifiers, key]
}

export async function activateCodexGlobalDictation(hotkey) {
  const capabilities = await detectDesktopCapabilities()
  if (!capabilities.codexDesktopRunning) throw new Error('codex-desktop-not-running')
  await sendKeys(parseGlobalHotkey(hotkey))
}

function wavFloat32(samples, sampleRate = 16000) {
  const dataBytes = samples.byteLength
  const output = Buffer.allocUnsafe(44 + dataBytes)
  output.write('RIFF', 0); output.writeUInt32LE(36 + dataBytes, 4); output.write('WAVE', 8)
  output.write('fmt ', 12); output.writeUInt32LE(16, 16); output.writeUInt16LE(3, 20); output.writeUInt16LE(1, 22)
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * 4, 28); output.writeUInt16LE(4, 32); output.writeUInt16LE(32, 34)
  output.write('data', 36); output.writeUInt32LE(dataBytes, 40)
  Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).copy(output, 44)
  return output
}

export async function transcribeNemotron(samples, paths) {
  await access(paths.executable)
  const directory = await mkdtemp(join(os.tmpdir(), 'dsh-dictation-'))
  const wave = join(directory, `${randomUUID()}.wav`)
  try {
    await writeFile(wave, wavFloat32(samples))
    const { stdout } = await run(paths.executable, ['transcribe', wave, '--model', paths.model, '--language', 'auto', '--quiet'], {
      env: { ...process.env, PATH: `${join(paths.runtime, 'bin')};${process.env.PATH ?? ''}` }, maxOutput: 4 * 1024 * 1024,
    })
    return stdout.trim().replace(/<[^>]+>\s*$/u, '').trim()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
