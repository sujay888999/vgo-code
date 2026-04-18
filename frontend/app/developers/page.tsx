'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  Download,
  HardDriveDownload,
  KeyRound,
  Layers3,
  Monitor,
  ReceiptText,
  ShieldCheck,
} from 'lucide-react';

const endpointRows = [
  {
    method: 'GET',
    path: 'https://vgoai.cn/api/v1/gateway/models/catalog',
    description: '读取当前公开模型目录。',
  },
  {
    method: 'GET',
    path: 'https://vgoai.cn/api/v1/gateway/v1/models',
    description: '读取当前 API Key 可调用的模型列表。',
  },
  {
    method: 'POST',
    path: 'https://vgoai.cn/api/v1/gateway/v1/chat/completions',
    description: '通过统一 OpenAI 兼容接口发起聊天调用。',
  },
];

const baseUrls = [
  { label: '网站 Base URL', value: 'https://vgoai.cn' },
  { label: '平台 API Base URL', value: 'https://vgoai.cn/api/v1' },
  { label: 'OpenAI 兼容网关 Base URL', value: 'https://vgoai.cn/api/v1/gateway/v1' },
];

const billingSteps = [
  '用户在账户中心创建 API Key，所有模型共用这套密钥。',
  '请求进入统一网关后，系统会根据 model 字段自动路由到对应模型服务。',
  '输入、输出、缓存读取与缓存写入价格统一按平台价格表结算。',
  '调用记录会同步写入请求日志、账户用量、后台统计和余额扣减。',
];

const operatorSteps = [
  '在后台新增渠道，填写接口地址、密钥、优先级和支持模型。',
  '使用推荐模型部署和单模型测试快速完成接入校验。',
  '为每个模型录入输入价、输出价、缓存读取价和缓存写入价。',
  '通过统一模型网关对外提供调用，不暴露底层实现细节。',
];

const localExecutorSteps = [
  '云端数字员工先完成任务拆解、审批判断和执行计划生成。',
  '经批准的本地任务会被封装为结构化动作包，发送给本地桥接器。',
  '本地桥接器调用 Open Interpreter，在你的电脑上执行白名单动作。',
  '执行日志、产物、截图和状态回执再同步回工作台。',
];

const curlExample = `curl https://vgoai.cn/api/v1/gateway/v1/chat/completions \\
  -H "Authorization: Bearer sk-your-api-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "gpt-5.4",
    "messages": [
      { "role": "user", "content": "请帮我写一段产品介绍。" }
    ]
  }'`;

const jsExample = `const response = await fetch("https://vgoai.cn/api/v1/gateway/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer sk-your-api-key",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-5.4",
    messages: [
      { role: "user", content: "帮我整理一份客服回复模板。" }
    ],
  }),
});

const data = await response.json();
console.log(data);`;

const pythonExample = `import requests

resp = requests.post(
    "https://vgoai.cn/api/v1/gateway/v1/chat/completions",
    headers={
        "Authorization": "Bearer sk-your-api-key",
        "Content-Type": "application/json",
    },
    json={
        "model": "gpt-5.4",
        "messages": [
            {"role": "user", "content": "生成一份上线检查清单。"}
        ],
    },
    timeout=120,
)

print(resp.json())`;

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#eef4ff,transparent_35%),linear-gradient(180deg,#f8fafc_0%,#f4f6fb_100%)] px-4 py-6 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="rounded-[36px] border border-white/80 bg-white/90 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
          <header className="grid gap-6 border-b border-slate-200 pb-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
            <div className="max-w-4xl">
              <div className="flex items-center gap-3">
                <Link
                  href="/chat"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Developers</div>
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-slate-950 md:text-5xl">
                接入文档与本地执行方案
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
                这里覆盖统一模型网关的 API 接入方式，以及数字员工通过本地执行器落地任务的协作链路。所有可调用模型统一使用 API Key、统一日志与统一计费口径。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">统一鉴权</div>
                <div className="mt-3 text-lg font-semibold text-slate-950">Authorization: Bearer sk-***</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">所有模型和所有调用方式都由同一套 API Key 授权。</div>
              </div>
              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">统一网关</div>
                <div className="mt-3 text-lg font-semibold text-slate-950">OpenAI 兼容接入</div>
                <div className="mt-2 text-sm leading-6 text-slate-600">模型协议差异由平台统一处理，接入方式尽量保持一致。</div>
              </div>
            </div>
          </header>

          <section className="mt-8 grid gap-4 lg:grid-cols-3">
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <KeyRound className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">统一 API Key</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">所有模型和所有调用方式都由同一套 API Key 授权。</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <Layers3 className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">统一网关</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">OpenAI 兼容模型统一走一个网关入口，协议差异由平台自动处理。</div>
            </div>
            <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
              <ReceiptText className="h-5 w-5 text-slate-500" />
              <div className="mt-4 text-xl font-semibold text-slate-950">统一计费</div>
              <div className="mt-2 text-sm leading-6 text-slate-600">输入、输出、缓存读取和缓存写入价格统一在平台内展示。</div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">基础地址</div>
              <div className="mt-4 grid gap-3">
                {baseUrls.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
                    <div className="mt-2 break-all font-mono text-sm text-slate-900">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 text-sm font-medium text-slate-900">可用端点</div>
              <div className="mt-3 overflow-hidden rounded-[24px] border border-slate-200">
                {endpointRows.map((row) => (
                  <div key={row.path} className="grid gap-3 border-b border-slate-200 bg-white px-4 py-4 last:border-b-0 md:grid-cols-[92px_1.4fr_1fr]">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{row.method}</div>
                    <div className="break-all font-mono text-sm text-slate-900">{row.path}</div>
                    <div className="text-sm text-slate-600">{row.description}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[30px] border border-slate-200 bg-slate-50 p-6">
              <div className="text-sm font-medium text-slate-900">计费与调用逻辑</div>
              <div className="mt-4 space-y-3">
                {billingSteps.map((item, index) => (
                  <div key={item} className="flex gap-4 rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                      {index + 1}
                    </div>
                    <div className="text-sm leading-7 text-slate-600">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-3">
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)] xl:col-span-2">
              <div className="text-sm font-medium text-slate-900">cURL 示例</div>
              <pre className="mt-4 overflow-x-auto rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                {curlExample}
              </pre>
            </div>
            <div className="rounded-[30px] border border-slate-200 bg-slate-50 p-6">
              <div className="text-sm font-medium text-slate-900">渠道部署步骤</div>
              <div className="mt-4 space-y-3">
                {operatorSteps.map((item, index) => (
                  <div key={item} className="rounded-[22px] border border-slate-200 bg-white px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step {index + 1}</div>
                    <div className="mt-2 text-sm leading-7 text-slate-600">{item}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-10 grid gap-6 xl:grid-cols-2">
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">JavaScript 示例</div>
              <pre className="mt-4 overflow-x-auto rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                {jsExample}
              </pre>
            </div>
            <div className="rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">Python 示例</div>
              <pre className="mt-4 overflow-x-auto rounded-[24px] border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                {pythonExample}
              </pre>
            </div>
          </section>

          <section className="mt-10 rounded-[30px] border border-slate-200 bg-slate-50 p-6">
            <div className="flex items-center gap-3 text-slate-900">
              <ShieldCheck className="h-5 w-5" />
              <div className="text-sm font-medium">本地执行链路</div>
            </div>
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {localExecutorSteps.map((item, index) => (
                <div key={item} className="rounded-[24px] border border-slate-200 bg-white px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Step {index + 1}</div>
                  <div className="mt-2 text-sm leading-7 text-slate-600">{item}</div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <Link
                href="/developers/local-executor"
                className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-3 text-sm font-medium text-white transition hover:bg-black"
              >
                <HardDriveDownload className="h-4 w-4" />
                查看本地执行器说明
              </Link>
            </div>
          </section>

          <section className="mt-10 rounded-[30px] border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-800 p-6 text-white">
            <div className="flex items-center gap-3">
              <Monitor className="h-5 w-5" />
              <div className="text-sm font-medium">VGO CODE 桌面应用</div>
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-2">
              <div>
                <div className="text-2xl font-semibold">本地 AI 编程助手</div>
                <div className="mt-2 text-sm leading-6 text-slate-300">
                  基于 Electron 的桌面应用，集成 Ollama 本地模型，支持多种 Agent 工具调用能力，可在本地电脑上完成复杂的编程任务。
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    支持 Ollama 所有模型
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    write_file / read_file / list_dir 等工具
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    多工作流支持
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 p-6">
                <div className="text-center">
                  <div className="text-lg font-semibold">VGO CODE v1.0.3</div>
                  <div className="mt-1 text-sm text-slate-400">Windows 安装包</div>
                </div>
                <a
                  href="https://vgoai.cn/downloads/vgo-code/VGO-CODE-Setup-1.0.3.exe"
                  download
                  className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-white transition hover:bg-emerald-600"
                >
                  <Download className="h-4 w-4" />
                  下载安装包
                </a>
                <div className="mt-3 text-xs text-slate-500">
                  版本检查：vgoai.cn/downloads/vgo-code/version.json
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
