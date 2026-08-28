# DSH 语音输入

为 DeepSeek Harness 输入框提供可编辑的语音转文字。

[English](./README.md)

- 麦克风紧靠发送按钮左侧。
- `Ctrl+Shift+D` 开始或停止听写。
- 识别结果只追加到当前草稿，不会自动发送。
- 在独立的 **设置 → 语音输入** 页面选择来源、下载或卸载本地模型。

## 识别来源

| 来源 | 适合场景 | 质量与可用范围 |
| --- | --- | --- |
| **SenseVoice Small** | 普通话、粤语、英语、日语和韩语的本地听写 | 默认均衡方案，约 228 MB。速度快、音频不上传，但嘈杂环境、标点和长语音精度可能低于桌面服务。 |
| **Paraformer Small** | 快速识别普通话和英语 | 体积最小，约 78 MB。其他语言和方言较多的语音不在主要适用范围。 |
| **Nemotron 3.5 ASR** | 本地多语言识别与模型自动语言检测 | 约 712 MB，另带本机运行时。本地方案中内存和 CPU 占用最高，多语言覆盖更广不代表所有麦克风和语言都更准确。 |
| **Codex 全局听写（Beta）** | 复用已安装的 Codex Desktop 听写能力 | 调用 Codex Desktop 的系统级切换快捷键，并把结果回填到当前 DSH 草稿。需要 Codex 正在运行且已配置全局切换快捷键；DSH 不读取 Codex 账号数据。 |

插件包本身不包含语音模型。只有用户点击“下载”后才会获取本地模型；下载内容会经过校验，并可分别卸载。

本地识别会持续聆听，直到再次点击麦克风。按 Escape 会取消当前录音且不修改草稿。Codex 全局听写也使用同一个 DSH 麦克风开始和停止。

## 安装

```powershell
irm 'https://github.com/WSL043/dsh-dictation/releases/download/v0.1.0-beta.1/install.ps1' | iex
```

也可以使用 DSH 官方命令：

```sh
dsh plugin --profile web add dsh-dictation@0.1.0-beta.1
```

安装完成后请先保存正在进行的工作，再手动重启 DSH。

## 更新

使用目标版本重新运行任一安装命令。

## 卸载

```sh
dsh plugin --profile web remove dsh-dictation
```

## 隐私

- SenseVoice、Paraformer 和 Nemotron 下载后均在本机运行。
- Codex Desktop 模式只读取本机配置的全局听写快捷键，不读取 Codex 账号数据。
- 听写结果只写入可编辑的 DSH 草稿，不会自动发送。

## 兼容性

已通过最新稳定版 DeepSeek Harness 验收。预览版兼容性只在独立验收后发布。

## 反馈

[反馈问题](https://github.com/WSL043/dsh-dictation/issues/new/choose)

## 许可证

MIT。详见 [LICENSE](./LICENSE) 和 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
