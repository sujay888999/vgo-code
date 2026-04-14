'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCode2,
  HardDrive,
  Laptop,
  PlayCircle,
  Shield,
  TerminalSquare,
  Workflow,
} from 'lucide-react';
import SiteLogo from '@/components/site-logo';

const downloads = [
  {
    title: 'Open Interpreter 安装脚本',
    description: '一键准备本地 Python 环境并安装执行器。',
    href: '/downloads/vgo-open-interpreter-installer.ps1',
    cta: '下载安装脚本',
  },
  {
    title: 'Local Bridge 脚本',
    description: '负责把 VGO-CODE 的任务和你电脑上的执行器连接起来。',
    href: '/downloads/vgo-local-bridge.py',
    cta: '下载 Bridge',
  },
  {
    title: 'Bridge 配置模板',
    description: '填写工作目录、用户令牌和本地允许执行的配置。',
    href: '/downloads/vgo-local-bridge.example.json',
    cta: '下载配置模板',
  },
];

const steps = [
  {
    title: '1. 下载工具包',
    body: '先下载安装脚本、Bridge 脚本和配置模板，建议统一放在本地工作目录里。',
  },
  {
    title: '2. 安装本地执行环境',
    body: '运行安装脚本后，会准备 Open Interpreter 及基础依赖，形成可执行的桌面端环境。',
  },
  {
    title: '3. 配置 Bridge',
    body: '把你的账号令牌、允许执行的目录和本地机器信息写入配置模板，然后启动 Bridge。',
  },
  {
    title: '4. 在工作台发起任务',
    body: 'VGO-CODE 会把云端任务转换成可执行动作，并把执行日志、产物和结果同步回站内。',
  },
];

const capabilities = [
  '本地文件读取、生成与整理',
  '白名单脚本执行与结果回传',
  '结构化日志、截图、产物同步',
  '和网站工作台联动的任务执行链路',
];

const boundaries = [
  '不会默认读取非白名单目录',
  '高风险动作必须先在站内审批',
  '不直接把本地系统控制权暴露给云端',
  '建议只在你自己的工作电脑上部署',
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
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Desktop Runtime</div>
            </div>

            <div className="mt-5 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-3">
                  <SiteLogo size="md" priority />
                  <div className="text-sm font-semibold tracking-[0.14em] text-slate-900">VGO-CODE</div>
                </div>
                <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 md:text-5xl">
                  桌面端下载与使用说明
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">
                  VGO-CODE 用来把站内任务延伸到你的本地电脑。它适合做文件生成、脚本执行、日志整理和本地交付，
                  同时把执行结果回传到 VGO AI 工作台。
                </p>
              </div>

              <div className="rounded-[28px] border border-cyan-200 bg-cyan-50 p-5 text-sm text-cyan-950 md:w-[320px]">
                <div className="text-xs uppercase tracking-[0.2em] text-cyan-700">Current Package</div>
                <div className="mt-3 text-xl font-semibold">VGO-CODE Desktop Kit</div>
                <div className="mt-2 leading-7 text-cyan-900/80">
                  当前提供 Windows 侧安装脚本、本地 Bridge 与配置模板，适合作为桌面端第一版部署方案。
                </div>
              </div>
            </div>
          </header>

          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {downloads.map((item) => (
              <a
                key={item.title}
                href={item.href}
                className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-300 hover:bg-white"
              >
                <div className="flex items-center justify-between">
                  <div className="inline-flex rounded-2xl border border-slate-200 bg-white p-3 text-slate-700">
                    <Download className="h-5 w-5" />
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    立即下载
                  </span>
                </div>
                <div className="mt-5 text-lg font-semibold text-slate-950">{item.title}</div>
                <div className="mt-2 text-sm leading-7 text-slate-600">{item.description}</div>
                <div className="mt-5 text-sm font-medium text-slate-900">{item.cta}</div>
              </a>
            ))}
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                <Workflow className="h-4 w-4 text-slate-500" />
                接入步骤
              </div>
              <div className="mt-5 space-y-3">
                {steps.map((step) => (
                  <div key={step.title} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-base font-semibold text-slate-950">{step.title}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-600">{step.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[30px] border border-slate-200 bg-slate-50 p-6">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <Laptop className="h-4 w-4 text-slate-500" />
                  VGO-CODE 可以做什么
                </div>
                <div className="mt-4 space-y-3">
                  {capabilities.map((item) => (
                    <div
                      key={item}
                      className="flex gap-3 rounded-[20px] border border-slate-200 bg-white px-4 py-4 text-sm leading-7 text-slate-700"
                    >
                      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[30px] border border-slate-200 bg-[#0f172a] p-6 text-white">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <Shield className="h-4 w-4 text-cyan-300" />
                  安全边界
                </div>
                <div className="mt-4 space-y-3">
                  {boundaries.map((item) => (
                    <div
                      key={item}
                      className="rounded-[20px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-slate-200"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <TerminalSquare className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-950">执行核心</div>
              <div className="mt-2 text-sm leading-7 text-slate-600">
                基于 Open Interpreter 构建本地执行能力，适合脚本、文件和工作目录任务。
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <HardDrive className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-950">本地桥接</div>
              <div className="mt-2 text-sm leading-7 text-slate-600">
                Bridge 常驻在本地电脑，负责轮询任务、执行动作、上传产物和状态。
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <FileCode2 className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-lg font-semibold text-slate-950">详细文档</div>
              <div className="mt-2 text-sm leading-7 text-slate-600">
                如果你要了解完整执行链路、目录结构和部署建议，可以继续查看本地执行文档。
              </div>
              <Link
                href="/developers/local-executor"
                className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-900"
              >
                <PlayCircle className="h-4 w-4" />
                查看详细说明
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
