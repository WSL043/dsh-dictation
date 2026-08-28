# DSH Dictation

Editable speech-to-text for the DeepSeek Harness composer.

[简体中文](./README.zh-CN.md)

- One microphone immediately beside the Send button.
- `Ctrl+Shift+D` starts or stops dictation.
- Recognition appends to the current draft and never sends the message.
- A dedicated **Settings → Dictation** page selects the source and manages local models.

## Recognition sources

| Source | Best fit | Quality and availability boundary |
| --- | --- | --- |
| **SenseVoice Small** | Private local dictation across Mandarin, Cantonese, English, Japanese and Korean | Balanced default at about 228 MB. Faster and more private than a desktop service, but punctuation, noisy speech and long-form accuracy can be lower. |
| **Paraformer Small** | Fast local Mandarin and English | Smallest option at about 78 MB. Other languages and dialect-heavy speech are outside its intended range. |
| **Nemotron 3.5 ASR** | Local multilingual recognition with model-based language detection | About 712 MB plus a native runtime. Uses the most memory and CPU of the local choices; broader language coverage does not guarantee higher accuracy on every microphone or language. |
| **Codex global dictation (Beta)** | Reusing an installed Codex Desktop dictation setup | Uses Codex Desktop's system-wide toggle shortcut and returns the transcript to the focused DSH draft. Codex must be running with a global toggle shortcut configured. DSH reads no Codex account data. |

The plugin package contains no speech model. Local models are downloaded only after the user selects **Download**, are verified before use, and can be removed independently.

Local recognition keeps listening until the microphone is clicked again. Pressing Escape cancels the current capture without changing the draft. Codex global dictation also starts and stops from the same DSH microphone.

## Install

```powershell
irm 'https://github.com/WSL043/dsh-dictation/releases/download/v0.1.0-beta.1/install.ps1' | iex
```

Or use the official DSH command:

```sh
dsh plugin --profile web add dsh-dictation@0.1.0-beta.1
```

Save active work and restart DSH manually after installation.

## Update

Run either installation command again with the desired version.

## Uninstall

```sh
dsh plugin --profile web remove dsh-dictation
```

## Privacy

- SenseVoice, Paraformer and Nemotron run locally after their model files are downloaded.
- Codex Desktop mode reads only the locally configured global dictation shortcut and does not read Codex account data.
- Dictation writes only to the editable DSH draft and never submits a message.

## Compatibility

Tested with the latest stable DeepSeek Harness release. Preview support is published only after separate acceptance.

## Feedback

[Report a problem](https://github.com/WSL043/dsh-dictation/issues/new/choose)

## License

MIT. See [LICENSE](./LICENSE) and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
