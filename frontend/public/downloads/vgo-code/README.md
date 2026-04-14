# VGO CODE 桌面应用

VGO CODE 是一款基于 Electron 的本地 AI 编程助手，集成了 Ollama 本地模型，支持多种 Agent 工具调用能力。

## 下载安装

**最新版本**: 1.0.0

> 安装包位于服务器: `https://vgoai.cn/downloads/vgo-code/VGO CODE Setup 1.0.0.exe`
> 
> 请在服务器上手动上传安装包到对应目录

## 功能特性

- **本地模型支持**: 支持 Ollama 所有模型（gemma4、qwen2.5-coder 等）
- **Agent 工具调用**: 支持 write_file、read_file、list_dir、run_command 等工具
- **多工作流**: 支持通用任务、代码审查、文件处理等多种工作流
- **Skill 扩展**: 支持加载外部 skill 扩展功能

## 系统要求

- Windows 10/11 (64-bit)
- Ollama 已安装并运行 (http://localhost:11434)
- 推荐 8GB+ RAM
- 推荐 10GB+ 可用磁盘空间

## Ollama 模型安装

```bash
# 安装推荐模型
ollama pull gemma4:latest
ollama pull qwen2.5-coder:7b
```

## 快速开始

1. 下载并安装 VGO CODE Setup 1.0.0.exe
2. 启动 Ollama 服务
3. 运行 VGO CODE
4. 在设置中配置 Ollama 模型
5. 开始使用！

## 技术架构

- **前端**: React + TypeScript
- **后端**: Electron + Node.js
- **模型**: Ollama API
- **构建**: electron-builder

## 版本更新

版本检查自动通过 `https://vgoai.cn/downloads/vgo-code/version.json` 进行。
