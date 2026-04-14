'use client';

import Link from 'next/link';

const sections = [
  {
    title: '1. 条款适用',
    body: '这些服务条款适用于你对 VGO AI 网站、聊天工作台、API、充值、后台能力及相关服务的使用。访问或使用 VGO AI 即表示你同意这些条款。',
  },
  {
    title: '2. 账户责任',
    body: '你需要对自己的账户、密码、API Key 以及账户内发生的操作负责，除非该行为由平台自身的安全失误直接导致。',
  },
  {
    title: '3. 服务内容',
    body: 'VGO AI 提供聊天工作台、模型路由、开发者 API、计费充值和后台运营能力。部分能力可能依赖第三方基础设施或外部模型服务。',
  },
  {
    title: '4. 合理使用',
    body: '你不得将 VGO AI 用于违法活动、欺诈、垃圾信息、恶意程序、侵权、违规监控或任何可能给平台带来法律、财务或安全风险的行为。',
  },
  {
    title: '5. AI 输出免责声明',
    body: 'AI 输出可能存在不准确、不完整、偏差或不适用的情况。你需要自行评估并复核输出结果，尤其是在商业、法律、金融、医疗和安全等高风险场景中。',
  },
  {
    title: '6. 套餐、余额与计费',
    body: 'VGO AI 可能提供订阅、预付余额、充值赠送、按量计费或企业定制方案。价格、包含额度和赠送策略可能随时间调整。',
  },
  {
    title: '7. 支付与退款',
    body: '支付可能通过第三方支付服务商完成。退款、失败支付、争议交易和促销赠送额度应以后续公开的账单与退款政策为准。',
  },
  {
    title: '8. 暂停与终止',
    body: '如你违反条款、触发风控、拖欠费用、造成平台风险，或遇到法律与合规义务要求，VGO AI 可能暂停、限制或终止你的服务访问。',
  },
  {
    title: '9. 第三方服务',
    body: 'VGO AI 依赖托管、支付、监控和外部服务等第三方能力。由第三方引起的价格变化、可用性变化或政策调整，不完全在平台控制范围内。',
  },
  {
    title: '10. 联系方式',
    body: '正式上线前，请将这里替换为你的客服邮箱、法务联络邮箱或公司主体联系信息。',
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="app-shell rounded-[32px] p-6 md:p-8">
          <header className="border-b border-slate-200 pb-6">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Terms of Service</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">VGO AI 服务条款</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
              生效日期请在正式上线前补充。本页已经按产品实际使用场景整理为正式草案，公开前仍建议做一次法务审阅。
            </p>
          </header>

          <section className="mt-8 space-y-5">
            {sections.map((section) => (
              <article
                key={section.title}
                className="rounded-[28px] border border-slate-200 bg-white/95 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.04)]"
              >
                <h2 className="text-xl font-semibold text-slate-950">{section.title}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-700">{section.body}</p>
              </article>
            ))}
          </section>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/privacy" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300">
              隐私政策
            </Link>
            <Link href="/pricing" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300">
              套餐
            </Link>
            <Link href="/" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300">
              返回首页
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
