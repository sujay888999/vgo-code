# VGO CODE 桌面应用

基于 Electron 的本地 AI 编程助手，无缝集成 VGO AI 平台，支持一键配置本地 Ollama 模型。

## 下载安装

**最新版本**: 1.0.3

[下载 VGO CODE 安装包](https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-1.0.3.exe)

---

## 核心功能

### 🌐 网站内模型自动配置（推荐）

VGO CODE 与 VGO AI 平台深度集成，支持自动配置模型：

- **智能检测**: 自动检测本地 Ollama 服务状态
- **一键配置**: 从平台模型目录自动拉取配置
- **即开即用**: 安装后首次启动自动引导配置

**支持的模型**：
| 模型 | 说明 |
|------|------|
| gemma4 | 谷歌最新推理模型，适合复杂任务 |
| qwen2.5-coder | 通义千问代码模型，专注编程辅助 |
| deepseek-coder | 深悉代码模型，代码生成能力强 |
| llama3.2 | Meta 开源大模型，用途广泛 |

### 💻 本地 Ollama 部署（可选）

如果需要完全离线使用，可以手动配置 Ollama：

```bash
# 安装 Ollama
# macOS/Linux: curl -fsSL https://ollama.com/install.sh
# Windows: 从 https://ollama.com/download 下载

# 拉取模型
ollama pull gemma4:latest
ollama pull qwen2.5-coder:7b

# 验证运行
ollama list
```

Ollama 默认地址：`http://localhost:11434`

---

## 系统要求

| 项目 | 要求 |
|------|------|
| 系统 | Windows 10/11 (64-bit) |
| 内存 | 推荐 8GB+ |
| 磁盘 | 推荐 10GB+ 可用空间 |
| 网络 | 首次使用需要网络（下载模型） |

---

## 快速开始

### 1. 安装
下载并运行 `VGO CODE Setup 1.0.3.exe`

### 2. 配置模型
- **自动配置（推荐）**: 启动后选择"从 VGO AI 平台配置"，自动下载配置
- **手动配置**: 启动已运行的 Ollama，应用自动检测

### 3. 开始使用
在对话框输入任务，Agent 自动规划并执行工具调用

---

## 工具能力

| 工具 | 功能 |
|------|------|
| write_file | 创建/编辑代码文件 |
| read_file | 读取文件内容 |
| list_dir | 浏览目录结构 |
| run_command | 执行终端命令 |
| search_code | 搜索代码内容 |
| open_path | 打开文件/文件夹 |

---

## 版本更新

版本检查地址：`https://vgoai.cn/downloads/vgo-code/version.json`

---

## 常见问题

**Q: 提示 Ollama 未运行？**
A: 确保 Ollama 已在后台运行，或使用平台自动配置功能。

**Q: 模型下载慢？**
A: 建议使用 VGO AI 平台的加速节点，或等待夜间低峰期。

**Q: 如何查看日志？**
A: 应用日志位于 `%APPDATA%/vgo-code/logs/`
