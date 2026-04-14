'use client';

import Link from 'next/link';
import { ArrowLeft, BookOpen, CreditCard, FileText, ReceiptText, Wallet } from 'lucide-react';

const chargingRules = [
  {
    title: '按量计费',
    body: '当前平台以按量消耗为主，模型调用按 token usage 统计成本，不再展示旧版固定套餐方案。',
    icon: ReceiptText,
  },
  {
    title: '输入输出分开计算',
    body: '输入 tokens 与输出 tokens 分别计费，再结合渠道倍率汇总成本，最终写入账户余额和请求日志。',
    icon: CreditCard,
  },
  {
    title: '统一账户扣费',
    body: '站内聊天工作台与开发者 API 共用同一套账户余额与消耗统计，方便统一结算和排查。',
    icon: Wallet,
  },
];

const notes = [
  '模型价格以模型目录和后台配置为准，价格展示单位为每 100 万 tokens。',
  '工作台聊天与 API 网关都会记录请求日志、tokens、成本与渠道信息。',
  '管理员账号当前允许在工作台内进行模型会话，不再被普通余额条件阻断。',
  '如后续要上线订阅、套餐或企业方案，建议单独新增新版商业页，而不是复用本页。 ',
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-6 md:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[32px] border border-white/80 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.06)] md:p-8">
          <header className="border-b border-slate-200 pb-8">
            <div className="flex items-center gap-3">
              <Link
                href="/models"
                className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Billing</div>
            </div>

            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-slate-950 md:text-5xl">
              VGO AI 计费说明
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
              这里保留当前站内的真实计费逻辑，替代旧版套餐展示内容。用户从模型目录进入后，可以直接了解调用方式、扣费口径和相关页面入口。
            </p>
          </header>

          <section className="mt-8 grid gap-4 md:grid-cols-3">
            {chargingRules.map((rule) => {
              const Icon = rule.icon;
              return (
                <article key={rule.title} className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white">
                    <Icon className="h-5 w-5 text-slate-700" />
                  </div>
                  <h2 className="mt-4 text-xl font-semibold text-slate-950">{rule.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{rule.body}</p>
                </article>
              );
            })}
          </section>

          <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">当前页面重点</div>
              <div className="mt-4 space-y-3">
                {notes.map((note) => (
                  <div key={note} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-7 text-slate-600">
                    {note.trim()}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">相关入口</div>
              <div className="mt-4 space-y-3">
                <Link
                  href="/models"
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-white"
                >
                  <BookOpen className="h-4 w-4" />
                  返回模型目录
                </Link>
                <Link
                  href="/developers"
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-white"
                >
                  <FileText className="h-4 w-4" />
                  查看开发者接入说明
                </Link>
                <Link
                  href="/dashboard"
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-white"
                >
                  <Wallet className="h-4 w-4" />
                  查看账户余额与消耗
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
