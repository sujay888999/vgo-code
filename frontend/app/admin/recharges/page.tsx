'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, Search, Wallet, ShieldCheck, XCircle } from 'lucide-react';
import { adminApi, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface RechargeRecord {
  id: string;
  orderNo: string;
  amount: number;
  bonus: number;
  paymentMethod: string;
  paymentStatus: string;
  transactionId?: string;
  createdAt: string;
  paidAt?: string;
  user?: {
    email: string;
    username: string;
  };
}

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '待审核' },
  { value: 'paid', label: '已到账' },
  { value: 'failed', label: '已驳回' },
];

function getStatusClasses(status: string) {
  const value = String(status || '').toLowerCase();
  if (value === 'paid') return 'border border-emerald-200 bg-emerald-50 text-emerald-700';
  if (value === 'pending') return 'border border-amber-200 bg-amber-50 text-amber-700';
  if (value === 'failed') return 'border border-rose-200 bg-rose-50 text-rose-700';
  return 'border border-slate-200 bg-slate-100 text-slate-700';
}

function getStatusLabel(status: string) {
  const value = String(status || '').toLowerCase();
  if (value === 'paid') return '已到账';
  if (value === 'pending') return '待审核';
  if (value === 'failed') return '已驳回';
  return status || '未知';
}

function getPaymentLabel(paymentMethod: string) {
  const value = String(paymentMethod || '').toLowerCase();
  if (value === 'usdt') return 'USDT';
  if (value === 'paypal') return 'PayPal';
  if (value === 'alipay') return '支付宝';
  if (value === 'wechat') return '微信';
  if (value === 'stripe') return 'Stripe';
  return paymentMethod || '未知方式';
}

export default function AdminRechargesPage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const router = useRouter();

  const [records, setRecords] = useState<RechargeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [pageError, setPageError] = useState('');

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated) {
        router.replace('/login');
      } else if (user && !user.isAdmin) {
        router.replace('/chat');
      }
    }
  }, [authLoading, isAuthenticated, router, user]);

  useEffect(() => {
    if (isAuthenticated && user?.isAdmin) {
      void loadRecharges();
    }
  }, [isAuthenticated, user, page, status]);

  async function loadRecharges() {
    setLoading(true);
    setPageError('');

    try {
      const response = await adminApi.getRecharges(page, 20, status || undefined);
      setRecords(response.data.data || []);
      setTotalPages(response.data.totalPages || 1);
    } catch (error: any) {
      setPageError(getApiErrorMessage(error, '读取支付订单失败，请稍后再试。'));
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(id: string, action: 'approve' | 'reject') {
    const note = window.prompt(
      action === 'approve'
        ? '可选：输入审核备注、人工参考号或到账说明'
        : '请输入驳回原因',
    );

    if (action === 'reject' && !note?.trim()) {
      return;
    }

    setProcessingId(id);
    setPageError('');

    try {
      await adminApi.updateRecharge(id, { action, note: note?.trim() || undefined });
      await loadRecharges();
    } catch (error: any) {
      setPageError(getApiErrorMessage(error, '处理订单失败，请稍后再试。'));
    } finally {
      setProcessingId(null);
    }
  }

  const filteredRecords = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return records;

    return records.filter((record) =>
      [record.orderNo, record.user?.email, record.user?.username, record.transactionId]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(value)),
    );
  }, [keyword, records]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          正在加载支付订单...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="app-shell rounded-[32px] p-6 md:p-8">
          <header className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Billing Ops</div>
                <h1 className="mt-2 text-3xl font-semibold text-slate-950">支付订单</h1>
              </div>
            </div>

            <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
              第 {page} / {Math.max(totalPages, 1)} 页
            </div>
          </header>

          <section className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-1 items-center gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索订单号、邮箱、用户名或参考号"
                className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>

            <select
              value={status}
              onChange={(event) => {
                setPage(1);
                setStatus(event.target.value);
              }}
              className="rounded-full border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </section>

          {pageError ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {pageError}
            </div>
          ) : null}

          <section className="mt-6 space-y-3">
            {filteredRecords.length ? (
              filteredRecords.map((record) => {
                const totalAmount = Number(record.amount) + Number(record.bonus);
                const isPaid = String(record.paymentStatus).toLowerCase() === 'paid';

                return (
                  <div
                    key={record.id}
                    className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-slate-900">{record.orderNo}</div>
                        <div className="mt-1 text-sm text-slate-500">
                          {record.user?.email || '未知用户'} · {record.user?.username || '未命名用户'}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          创建于 {new Date(record.createdAt).toLocaleString()}
                          {record.paidAt ? ` · 到账于 ${new Date(record.paidAt).toLocaleString()}` : ''}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600">
                            支付方式 {getPaymentLabel(record.paymentMethod)}
                          </span>
                          <span className={`rounded-full px-3 py-1 text-xs font-medium ${getStatusClasses(record.paymentStatus)}`}>
                            {getStatusLabel(record.paymentStatus)}
                          </span>
                          {record.transactionId ? (
                            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">
                              参考号 {record.transactionId}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <CreditCard className="h-4 w-4 text-sky-600" />
                            充值金额
                          </div>
                          <div className="mt-2 text-xl font-semibold text-slate-950">
                            ${Number(record.amount).toFixed(2)}
                          </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <Wallet className="h-4 w-4 text-emerald-600" />
                            实际到账
                          </div>
                          <div className="mt-2 text-xl font-semibold text-slate-950">
                            ${totalAmount.toFixed(2)}
                          </div>
                        </div>

                        {!isPaid ? (
                          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm text-slate-500">审核动作</div>
                            <div className="mt-3 flex gap-2">
                              <button
                                onClick={() => void handleReview(record.id, 'approve')}
                                disabled={processingId === record.id}
                                className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-2 text-xs text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50"
                              >
                                <ShieldCheck className="h-3.5 w-3.5" />
                                通过
                              </button>
                              <button
                                onClick={() => void handleReview(record.id, 'reject')}
                                disabled={processingId === record.id}
                                className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-2 text-xs text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                驳回
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
                当前筛选条件下没有订单记录。
              </div>
            )}
          </section>

          <section className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page === 1}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-slate-300 disabled:opacity-40"
            >
              上一页
            </button>
            <button
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
              disabled={page === totalPages}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-slate-300 disabled:opacity-40"
            >
              下一页
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
