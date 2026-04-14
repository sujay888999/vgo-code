import Link from 'next/link';

export default function ManualCheckoutPage({ params }: { params: { orderNo: string } }) {
  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto max-w-4xl">
        <div className="app-shell rounded-[32px] p-6 md:p-8">
          <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Manual Checkout</div>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">订单 {params.orderNo}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600">
            这个页面用于承接 USDT 或其他人工确认支付流程。你可以回到充值页查看完整支付说明、
            收款地址、网络信息，并在支付完成后提交交易哈希进行自动核验。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/recharge"
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
            >
              返回充值页
            </Link>
            <Link
              href="/terms"
              className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition hover:border-slate-300"
            >
              服务条款
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
