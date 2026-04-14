'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Globe,
  HardDrive,
  Laptop,
  Monitor,
  Settings,
  Sparkles,
  TerminalSquare,
  Wifi,
} from 'lucide-react';
import SiteLogo from '@/components/site-logo';

const downloads = [
  {
    title: 'VGO CODE 安装包',
    description: 'Windows 桌面应用，支持一键配置模型，即开即用。',
    href: '/downloads/vgo-code/VGO%20CODE%20Setup%201.0.0.exe',
    cta: '下载安装包',
    badge: '推荐',
  },
];

const features = [
  {
    icon: Globe,
    title: '网站内模型自动配置',
    description: '从 VGO AI 平台模型目录一键拉取配置，智能检测本地环境，无需手动设置。',
    highlight: true,
  },
  {
    icon: Wifi,
    title: '本地 Ollama 深度集成',
    description: '支持 Ollama 所有模型（gemma4、qwen2.5-coder、deepseek-coder 等），完全离线可用。',
  },
  {
    icon: Sparkles,
    title: '智能 Agent 工具调用',
    description: 'write_file、read_file、run_command 等工具自动规划执行，完成复杂编程任务。',
  },
  {
    icon: Settings,
    title: '零配置体验',
    description: '安装后首次启动自动引导配置，开箱即用，无需折腾。',
  },
];

const models = [
  { name: 'qwen2.5', desc: '通义千问，国产旗舰大模型' },
  { name: 'qwen2.5-coder', desc: '通义千问代码模型，专注编程' },
  { name: 'qwen3', desc: '通义千问最新一代，全面超越前代' },
  { name: 'deepseek-v3', desc: '深度求索最新模型，推理能力超强' },
  { name: 'deepseek-coder', desc: '代码专用模型，代码生成能力强' },
  { name: 'gemma4', desc: '谷歌最新推理模型，适合复杂任务' },
  { name: 'gemma3', desc: '谷歌开源大模型，用途广泛' },
  { name: 'llama4', desc: 'Meta 最新开源大模型' },
  { name: 'llama3.2', desc: 'Meta 开源模型，用途广泛' },
  { name: 'llama3.1', desc: 'Meta 开源模型，8B/70B 多规格' },
  { name: 'mistral', desc: 'Mistral AI 开源模型' },
  { name: 'codellama', desc: 'Meta 代码专用模型' },
  { name: 'phi4', desc: '微软小钢炮，多语言能力强' },
  { name: 'nemotron', desc: 'NVIDIA 开源大模型' },
  { name: 'yi', desc: '零一万物开源模型' },
  { name: 'command-r', desc: 'Cohere 开源推理模型' },
];

const steps = [
  {
    title: '下载安装',
    body: '下载 VGO CODE 安装包，运行安装程序。',
  },
  {
    title: '首次启动配置',
    body: '启动后选择「从 VGO AI 平台配置」，或等待自动检测本地 Ollama。',
  },
  {
    title: '开始使用',
    body: '在对话框输入任务，Agent 自动规划并执行工具调用。',
  },
];

const ollamaSteps = [
  '从 ollama.com 下载安装 Ollama',
  '启动 Ollama 服务（默认 http://localhost:11434）',
  '可选：手动拉取模型 `ollama pull gemma4:latest`',
  'VGO CODE 会自动检测并连接',
];

export default function TeamsPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-6 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.06)] md:p-8">
          <header className="border-b border-slate-200 pb-8">
            <div className="flex items-center gap-3">
              <Link
                href="/chat"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Desktop App</div>
            </div>

            <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-3">
                  <SiteLogo size="md" priority />
                  <div className="text-sm font-semibold tracking-[0.14em] text-slate-900">VGO-CODE</div>
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 md:text-5xl">
                  本地 AI 编程助手
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
                  基于 Electron 的桌面应用，集成 Ollama 本地模型，支持网站内模型自动配置，
                  无需手动配置，开箱即用。
                </p>
              </div>

              <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 p-5 md:w-[320px]">
                <div className="text-xs uppercase tracking-[0.2em] text-emerald-700">Latest Version</div>
                <div className="mt-3 text-xl font-semibold">VGO CODE v1.0.0</div>
                <div className="mt-2 leading-7 text-emerald-900/80">
                  支持网站模型自动配置，本地 Ollama 深度集成，零配置体验。
                </div>
              </div>
            </div>
          </header>

          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {downloads.map((item) => (
              <a
                key={item.title}
                href={item.href}
                className="group rounded-[28px] border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 transition hover:border-emerald-400 hover:shadow-lg"
              >
                <div className="flex items-center justify-between">
                  <div className="inline-flex rounded-2xl border border-emerald-200 bg-white p-3 text-emerald-600">
                    <Download className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                    {item.badge}
                  </span>
                </div>
                <div className="mt-5 text-lg font-semibold text-slate-950">{item.title}</div>
                <div className="mt-2 text-sm leading-7 text-slate-600">{item.description}</div>
                <div className="mt-5 text-sm font-medium text-emerald-600 group-hover:text-emerald-700">
                  {item.cta} →
                </div>
              </a>
            ))}
          </section>

          <section className="mt-10">
            <div className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Sparkles className="h-5 w-5 text-emerald-500" />
              核心功能
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className={`rounded-[24px] border p-5 ${
                    feature.highlight
                      ? 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-white'
                      : 'border-slate-200 bg-slate-50'
                  }`}
                >
                  <div className={`inline-flex rounded-2xl p-3 ${feature.highlight ? 'bg-emerald-100' : 'bg-white'}`}>
                    <feature.icon className={`h-5 w-5 ${feature.highlight ? 'text-emerald-600' : 'text-slate-600'}`} />
                  </div>
                  <div className="mt-4 text-lg font-semibold text-slate-950">{feature.title}</div>
                  <div className="mt-2 text-sm leading-7 text-slate-600">{feature.description}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-10">
            <div className="rounded-[30px] border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-6">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
                <Globe className="h-4 w-4" />
                支持的模型（基于 Ollama）
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {models.map((model) => (
                  <div key={model.name} className="rounded-[16px] border border-emerald-200 bg-white p-3">
                    <div className="font-mono text-sm font-semibold text-emerald-700">{model.name}</div>
                    <div className="mt-1 text-xs text-slate-500">{model.desc}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-200/50 bg-emerald-50/50 p-3 text-xs text-slate-600">
                <strong>所有 Ollama 模型</strong>：VGO CODE 基于 Ollama，理论上支持 Ollama 模型库中的所有模型。
                只需运行 <code className="rounded bg-emerald-100 px-1.5 py-0.5 font-mono text-emerald-700">ollama pull 模型名</code> 即可使用。
              </div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-2">
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <TerminalSquare className="h-4 w-4 text-slate-500" />
                快速开始
              </div>
              <div className="mt-5 space-y-3">
                {steps.map((step, index) => (
                  <div key={step.title} className="flex gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                      {index + 1}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-base font-semibold text-slate-950">{step.title}</div>
                      <div className="mt-1 text-sm leading-7 text-slate-600">{step.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <HardDrive className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-950">本地 Ollama（可选）</div>
              <div className="mt-3 space-y-2 text-sm leading-7 text-slate-600">
                <p>如果需要完全离线使用，可以手动安装 Ollama：</p>
              </div>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-900 p-4 font-mono text-xs text-slate-300">
                ollama pull gemma4:latest
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-600">
                {ollamaSteps.map((step) => (
                  <div key={step} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <Monitor className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-950">系统要求</div>
              <div className="mt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">系统</span>
                  <span className="font-medium">Windows 10/11 (64-bit)</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">内存</span>
                  <span className="font-medium">推荐 8GB+</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">磁盘</span>
                  <span className="font-medium">推荐 10GB+</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">网络</span>
                  <span className="font-medium">首次需要（下载模型）</span>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <Laptop className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-950">工具能力</div>
              <div className="mt-4 space-y-3">
                {[
                  'write_file - 创建/编辑代码',
                  'read_file - 读取文件内容',
                  'list_dir - 浏览目录',
                  'run_command - 执行命令',
                  'search_code - 搜索代码',
                ].map((tool) => (
                  <div key={tool} className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <span>{tool}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
