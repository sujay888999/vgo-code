'use client';

import Link from 'next/link';

const sections = [
  {
    title: '1. 适用范围',
    body: '本隐私政策说明 VGO AI 在你访问网站、注册账户、购买余额或套餐、使用聊天工作台、调用 API 以及联系支持时，如何收集、使用、存储和保护你的信息。',
  },
  {
    title: '2. 我们收集的信息',
    body: '我们可能收集账户信息、登录信息、订单与支付状态、调用日志、会话记录、模型使用数据、IP 与设备信息，以及你在工单或客服沟通中主动提交的内容。',
  },
  {
    title: '3. 信息用途',
    body: '这些信息会被用于身份验证、服务交付、计费对账、风控防滥用、稳定性优化、客户支持、合规处理以及平台安全保护。',
  },
  {
    title: '4. 模型输入与输出',
    body: '当你使用聊天或 API 功能时，提示词、文件、消息和输出可能会经过 VGO AI 的系统以及第三方基础设施或外部模型服务处理。请避免在未评估风险前提交敏感数据。',
  },
  {
    title: '5. 支付信息',
    body: '当支付由第三方机构处理时，VGO AI 不会在自有服务器中保存完整银行卡信息。我们可能保留订单号、支付方式、支付状态、时间戳和支付参考号等有限账务信息。',
  },
  {
    title: '6. Cookie 与本地存储',
    body: '我们可能使用 Cookie、Token 和本地存储维持登录状态、保存界面偏好、增强安全性并分析产品表现。禁用后可能影响部分功能体验。',
  },
  {
    title: '7. 跨境处理',
    body: 'VGO AI 可能在新加坡或由托管服务商、支付服务商和基础设施供应商使用的其他地区处理数据。如你从其他地区访问，可能发生跨境传输。',
  },
  {
    title: '8. 保存期限',
    body: '我们只会在服务交付、风控、安全、会计、法律合规和争议处理所需范围内保留数据。账务和审计类记录的保存时间通常长于普通会话内容。',
  },
  {
    title: '9. 你的权利',
    body: '依据适用法律，你可能享有访问、更正、删除、限制处理、反对处理或申请副本等权利。在处理前，我们可能需要核验你的身份。',
  },
  {
    title: '10. 联系方式',
    body: '正式上线前，请将这里替换为你的客服邮箱、隐私联络邮箱或公司主体联系信息。',
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="app-shell rounded-[32px] p-6 md:p-8">
          <header className="border-b border-slate-200 pb-6">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Privacy Policy</div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight text-slate-950">VGO AI 隐私政策</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600 md:text-base">
              生效日期请在正式上线前补充。本页已经按产品实际场景整理为上线草案，公开前仍建议做一次正式法务审阅。
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
            <Link href="/terms" className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300">
              服务条款
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
