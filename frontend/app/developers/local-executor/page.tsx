'use client';

import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Download, HardDrive, Laptop, Network, Shield, TerminalSquare } from 'lucide-react';

const chain = [
  {
    title: '1. 数字员工生成执行计划',
    body: '团队先在云端完成拆任务、角色分工、优先级排序和审批建议，形成结构化动作包。',
  },
  {
    title: '2. 工作台触发审批',
    body: '高风险动作必须由主人确认。只有通过审批的动作才会被发送给本地桥接器。',
  },
  {
    title: '3. 本地桥接器接单',
    body: '本地服务常驻在你的电脑，负责接收动作、校验白名单目录、拉起 Open Interpreter。',
  },
  {
    title: '4. Open Interpreter 执行本地动作',
    body: '执行读写文件、运行白名单脚本、生成文档、整理目录、截图回传等动作。',
  },
  {
    title: '5. 回传结果到 VGO AI',
    body: '本地桥接器把日志、产物路径、执行摘要和失败原因同步回工作台，形成完整审计轨迹。',
  },
];

const rollout = [
  '第一阶段：先开放低风险动作，例如读取指定工作目录、生成文档、执行白名单脚本。',
  '第二阶段：支持本地文件整理、批处理、截图回执和更细的状态同步。',
  '第三阶段：再接入更强的本地执行器或插件生态，例如 OpenHands、浏览器自动化、桌面动作桥接。',
];

const installSteps = [
  '安装脚本默认把 Python 3.12 安装到 E:\\Python312。',
  'Open Interpreter 虚拟环境安装到 E:\\VGO-Local-Executor\\oi312-env。',
  '启动入口生成在 E:\\VGO-Local-Executor\\launch-open-interpreter.bat。',
  '后续本地桥接器建议部署到 E:\\VGO-Local-Executor\\bridge。',
];

const actions = [
  '读取指定项目目录并整理文件清单',
  '生成 Markdown 报告并写回工作区',
  '执行白名单 PowerShell / Python 脚本',
  '抓取本地日志并返回摘要',
  '输出截图、日志、产物路径和执行回执',
];

const forbidden = [
  '未经审批直接删除文件或批量修改系统配置',
  '读取非白名单目录的敏感文件',
  '后台静默执行高风险命令',
  '让云端直接获取本地系统权限',
];

export default function LocalExecutorPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-6 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[32px] border border-white/80 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.06)] md:p-8">
          <header className="border-b border-slate-200 pb-8">
            <div className="flex items-center gap-3">
              <Link
                href="/developers"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Local Executor Guide</div>
            </div>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 md:text-5xl">
              本地执行器与数字员工执行链路
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
              VGO AI 的数字员工不应该只停留在“讨论方案”。这套方案把云端协作与本地执行拆开：
              云端负责团队协作、审批和记忆，本地负责安全执行和回传结果。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href="/downloads/vgo-open-interpreter-installer.ps1"
                className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-black"
              >
                <Download className="h-4 w-4" />
                下载 Open Interpreter 安装脚本
              </a>
              <a
                href="/downloads/vgo-local-bridge.py"
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
              >
                下载本地 Bridge 脚本
              </a>
              <a
                href="/downloads/vgo-local-bridge.example.json"
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
              >
                下载桥接配置模板
              </a>
            </div>
          </header>

          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <Network className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">云端编排</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">任务拆解、审批、团队协作、状态跟踪都留在云端工作台。</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <Laptop className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">本地桥接</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">你的电脑只运行本地桥接服务，不暴露系统控制权给云端。</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <TerminalSquare className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">Open Interpreter</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">负责实际的本地命令、文件、脚本和产物生成。</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <Shield className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">审批与审计</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">每个动作都有来源、审批、日志、执行结果和失败原因。</div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">完整执行链路</div>
              <div className="mt-4 space-y-3">
                {chain.map((item) => (
                  <div key={item.title} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-base font-semibold text-slate-950">{item.title}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-600">{item.body}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[30px] border border-slate-200 bg-slate-50 p-6">
                <div className="text-sm font-medium text-slate-900">本地部署位置</div>
                <div className="mt-4 space-y-3">
                  {installSteps.map((item, index) => (
                    <div key={item} className="rounded-[22px] border border-slate-200 bg-white px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step {index + 1}</div>
                      <div className="mt-2 text-sm leading-7 text-slate-600">{item}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[30px] border border-slate-200 bg-[#0f172a] p-6 text-white">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-cyan-300">
                  <HardDrive className="h-4 w-4" />
                  Rollout
                </div>
                <div className="mt-4 space-y-3">
                  {rollout.map((item) => (
                    <div key={item} className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-7 text-slate-200">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-2">
            <div className="rounded-[30px] border border-emerald-200 bg-emerald-50 p-6">
              <div className="text-sm font-medium text-emerald-950">建议第一批开放的动作</div>
              <div className="mt-4 space-y-3">
                {actions.map((item) => (
                  <div key={item} className="flex gap-3 rounded-[20px] border border-emerald-200 bg-white px-4 py-4 text-sm leading-7 text-slate-700">
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[30px] border border-rose-200 bg-rose-50 p-6">
              <div className="text-sm font-medium text-rose-950">上线前必须禁止的动作</div>
              <div className="mt-4 space-y-3">
                {forbidden.map((item) => (
                  <div key={item} className="rounded-[20px] border border-rose-200 bg-white px-4 py-4 text-sm leading-7 text-slate-700">
                    {item}
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
