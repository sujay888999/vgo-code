'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import {
  ArrowLeft,
  Check,
  CreditCard,
  ExternalLink,
  Landmark,
  Loader2,
  Copy,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { getApiErrorMessage, rechargeApi, userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface RechargePackage {
  amount: number;
  bonus: number;
  display: string;
}

type PaymentMethod = 'stripe' | 'alipay' | 'wechat' | 'paypal' | 'usdt';
type CurrencyMode = 'usd' | 'cny';

interface PaymentMethodCapability {
  id: PaymentMethod;
  title: string;
  description: string;
  configured: boolean;
  requiresRedirect: boolean;
  mode: 'redirect' | 'manual_transfer' | 'manual_crypto';
  provider: 'manual' | 'paypal' | 'usdt';
  statusLabel: string;
  unavailableReason?: string;
}

interface OrderView {
  orderNo: string;
  amount: number;
  bonus: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  transactionId?: string;
  createdAt?: string;
  paidAt?: string;
}

interface CheckoutInfo {
  mode: 'redirect' | 'manual_transfer' | 'manual_crypto' | string;
  provider?: string;
  paymentUrl: string;
  paymentMethodTypes?: string[];
  sessionId?: string;
  providerOrderId?: string;
  transactionReference?: string;
  walletAddress?: string;
  network?: string;
  amount?: string;
  currency?: string;
  manualDetails?: {
    accountName?: string;
    accountNo?: string;
    paymentLink?: string;
    qrCodeUrl?: string;
    recipientNote?: string;
  };
  message: string;
}

const DISPLAY_CNY_RATE = 7.2;

function formatCurrency(amount: number, mode: CurrencyMode) {
  if (mode === 'cny') {
    return `CNY ${(amount * DISPLAY_CNY_RATE).toFixed(2)}`;
  }
  return `$${amount.toFixed(2)}`;
}

function getStatusTone(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'failed':
      return 'border-rose-200 bg-rose-50 text-rose-700';
    default:
      return 'border-amber-200 bg-amber-50 text-amber-700';
  }
}

function getStatusLabel(status?: string) {
  switch ((status || '').toLowerCase()) {
    case 'paid':
      return '已支付';
    case 'failed':
      return '已失败';
    default:
      return '待支付';
  }
}

function RechargePageContent() {
  const { isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [methods, setMethods] = useState<PaymentMethodCapability[]>([]);
  const [balance, setBalance] = useState(0);
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('usdt');
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [refreshingOrder, setRefreshingOrder] = useState(false);
  const [retryingOrder, setRetryingOrder] = useState(false);
  const [confirmingProvider, setConfirmingProvider] = useState(false);
  const [currencyMode, setCurrencyMode] = useState<CurrencyMode>('usd');
  const [orderMessage, setOrderMessage] = useState('');
  const [orderError, setOrderError] = useState('');
  const [creationNotice, setCreationNotice] = useState('');
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [walletQrCode, setWalletQrCode] = useState('');
  const [lastOrder, setLastOrder] = useState<OrderView | null>(null);
  const [checkoutInfo, setCheckoutInfo] = useState<CheckoutInfo | null>(null);
  const [txHash, setTxHash] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const orderStatusRef = useRef<HTMLElement | null>(null);
  const [autoScrollOrderNo, setAutoScrollOrderNo] = useState('');

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      void loadData();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const orderNo = searchParams.get('orderNo');
    const status = searchParams.get('status');
    const providerOrderId = searchParams.get('token') || searchParams.get('orderId');

    if (!orderNo) return;
    void inspectReturnedOrder(orderNo, status, providerOrderId || undefined);
  }, [searchParams]);

  useEffect(() => {
    if (!autoScrollOrderNo) return;
    if (lastOrder?.orderNo !== autoScrollOrderNo) return;

    const timer = window.setTimeout(() => {
      orderStatusRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setAutoScrollOrderNo('');
    }, 120);

    return () => window.clearTimeout(timer);
  }, [autoScrollOrderNo, lastOrder]);

  useEffect(() => {
    if (!creationNotice) return;

    const timer = window.setTimeout(() => {
      setCreationNotice('');
    }, 2600);

    return () => window.clearTimeout(timer);
  }, [creationNotice]);

  useEffect(() => {
    if (!copiedWallet) return;

    const timer = window.setTimeout(() => {
      setCopiedWallet(false);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [copiedWallet]);

  useEffect(() => {
    const walletAddress = checkoutInfo?.provider === 'usdt' ? checkoutInfo.walletAddress?.trim() : '';
    if (!walletAddress) {
      setWalletQrCode('');
      return;
    }

    let cancelled = false;
    void QRCode.toDataURL(walletAddress, {
      width: 220,
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((dataUrl) => {
        if (!cancelled) {
          setWalletQrCode(dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWalletQrCode('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [checkoutInfo]);

  const amount = selectedAmount || Number(customAmount || 0);
  const bonus = useMemo(() => {
    if (amount >= 1000) return amount * 0.2;
    if (amount >= 500) return amount * 0.15;
    if (amount >= 200) return amount * 0.1;
    if (amount >= 100) return amount * 0.05;
    return 0;
  }, [amount]);

  const selectedMethodMeta = methods.find((item) => item.id === selectedMethod);
  const pendingOrder = lastOrder?.paymentStatus === 'pending';

  async function loadData() {
    try {
      const [packageResponse, balanceResponse, methodResponse] = await Promise.all([
        rechargeApi.getPackages(),
        userApi.getBalance(),
        rechargeApi.getMethods(),
      ]);
      const methodList = methodResponse.data?.data || [];
      setPackages(packageResponse.data);
      setBalance(Number(balanceResponse.data.balance || 0));
      setMethods(methodList);

      const preferredMethod =
        methodList.find((item: PaymentMethodCapability) => item.id === 'usdt' && item.configured)?.id ||
        methodList.find((item: PaymentMethodCapability) => item.configured)?.id;

      if (
        preferredMethod &&
        !methodList.some((item: PaymentMethodCapability) => item.id === selectedMethod && item.configured)
      ) {
        setSelectedMethod(preferredMethod);
      }
    } catch (error) {
      console.error('Failed to load recharge data', error);
    }
  }

  async function restoreCheckoutInfo(orderNo: string) {
    try {
      const response = await rechargeApi.retryRecharge(orderNo);
      setCheckoutInfo(response.data.checkout || null);
      if (response.data.checkout?.message) {
        setOrderMessage(response.data.checkout.message);
      }
    } catch (error: any) {
      setOrderError(getApiErrorMessage(error, '无法恢复付款指引，请点击重新发起支付。'));
    }
  }

  async function inspectReturnedOrder(orderNo: string, status?: string | null, providerOrderId?: string) {
    setOrderError('');
    setOrderMessage('');

    try {
      const orderResponse = await rechargeApi.getOrder(orderNo);
      setLastOrder(orderResponse.data);

      if (status === 'paypal-approve' && providerOrderId) {
        setConfirmingProvider(true);
        const confirmResponse = await rechargeApi.confirmRecharge(orderNo, { providerOrderId });
        if (confirmResponse.data?.recharge) {
          setLastOrder(confirmResponse.data.recharge);
        }
        setOrderMessage(confirmResponse.data?.message || 'PayPal 订单已经确认。');
        await loadData();
        return;
      }

      if (orderResponse.data?.paymentStatus === 'pending') {
        await restoreCheckoutInfo(orderNo);
      }

      if (['success', 'paypal-approve'].includes(status || '')) {
        await refreshOrder(orderNo, true);
      } else if (status === 'cancelled' || status === 'paypal-cancelled') {
        setOrderMessage('你已取消本次支付，订单仍然保留，可以稍后重新发起。');
      }
    } catch (error: any) {
      setOrderError(getApiErrorMessage(error, '读取订单状态失败，请稍后再试。'));
    } finally {
      setConfirmingProvider(false);
    }
  }
  async function refreshOrder(orderNo: string, silent = false) {
    if (!silent) {
      setRefreshingOrder(true);
      setOrderError('');
      setOrderMessage('');
    }

    try {
      const response = await rechargeApi.refreshOrder(orderNo);
      if (response.data?.recharge) {
        setLastOrder(response.data.recharge);
      }
      if (response.data?.message) {
        setOrderMessage(response.data.message);
      }
      if (response.data?.recharge?.paymentStatus === 'pending' && !checkoutInfo) {
        await restoreCheckoutInfo(orderNo);
      }
      await loadData();
    } catch (error: any) {
      if (!silent) {
        setOrderError(getApiErrorMessage(error, '刷新订单状态失败，请稍后再试。'));
      }
    } finally {
      if (!silent) {
        setRefreshingOrder(false);
      }
    }
  }

  async function retryOrder(orderNo: string) {
    setRetryingOrder(true);
    setOrderError('');
    setOrderMessage('');

    try {
      const response = await rechargeApi.retryRecharge(orderNo);
      setCheckoutInfo(response.data.checkout || null);
      setOrderMessage(response.data?.checkout?.message || '已重新生成支付指引。');

      if (response.data?.checkout?.paymentUrl && response.data?.checkout?.mode === 'redirect') {
        window.location.href = response.data.checkout.paymentUrl;
      }
    } catch (error: any) {
      setOrderError(getApiErrorMessage(error, '重新发起支付失败，请稍后再试。'));
    } finally {
      setRetryingOrder(false);
    }
  }

  async function handleCreateOrder() {
    if (!amount || amount <= 0) {
      setOrderError('请输入正确的充值金额。');
      return;
    }

    if (!selectedMethodMeta?.configured) {
      setOrderError(selectedMethodMeta?.unavailableReason || '当前支付方式尚未配置。');
      return;
    }

    setCreatingOrder(true);
    setOrderError('');
    setOrderMessage('');
    setCreationNotice('');
    setTxHash('');
    setPaymentReference('');

    try {
      const response = await rechargeApi.createRecharge(amount, selectedMethod);
      setCheckoutInfo(response.data.checkout || null);
      setLastOrder({
        orderNo: response.data.orderNo,
        amount: Number(response.data.amount),
        bonus: Number(response.data.bonus),
        total: Number(response.data.total),
        paymentMethod: response.data.paymentMethod,
        paymentStatus: response.data.status,
      });
      setAutoScrollOrderNo(response.data.orderNo);
      if (selectedMethod === 'usdt') {
        setCreationNotice('订单已创建，正在为你定位到下方 USDT 转账信息。');
      } else {
        setCreationNotice('订单已创建，正在为你定位到下方付款指引。');
      }

      if (response.data?.checkout?.paymentUrl && selectedMethodMeta?.requiresRedirect) {
        window.location.href = response.data.checkout.paymentUrl;
        return;
      }

      setOrderMessage(response.data?.checkout?.message || '订单已创建，请继续完成支付。');
      await loadData();
    } catch (error: any) {
      setOrderError(getApiErrorMessage(error, '创建充值订单失败，请稍后再试。'));
    } finally {
      setCreatingOrder(false);
    }
  }

  async function handleSubmitUsdtHash() {
    if (!lastOrder?.orderNo || !txHash.trim()) {
      setOrderError('请先填写链上交易哈希。');
      return;
    }

    setRefreshingOrder(true);
    setOrderError('');
    setOrderMessage('');

    try {
      const response = await rechargeApi.confirmRecharge(lastOrder.orderNo, {
        transactionReference: txHash.trim(),
      });
      if (response.data?.recharge) {
        setLastOrder(response.data.recharge);
      }
      setOrderMessage(response.data?.message || '交易哈希已提交，系统正在校验。');
      await loadData();
    } catch (error: any) {
      setOrderError(getApiErrorMessage(error, '提交交易哈希失败，请稍后再试。'));
    } finally {
      setRefreshingOrder(false);
    }
  }

  async function handleSubmitManualReference() {
    if (!lastOrder?.orderNo || !paymentReference.trim()) {
      setOrderError('请先填写付款凭证编号、交易号或备注。');
      return;
    }

    setRefreshingOrder(true);
    setOrderError('');
    setOrderMessage('');

    try {
      const response = await rechargeApi.confirmRecharge(lastOrder.orderNo, {
        transactionReference: paymentReference.trim(),
      });
      if (response.data?.recharge) {
        setLastOrder(response.data.recharge);
      }
      setOrderMessage(response.data?.message || '付款凭证已提交，正在等待审核。');
      await loadData();
    } catch (error: any) {
      setOrderError(getApiErrorMessage(error, '提交付款凭证失败，请稍后再试。'));
    } finally {
      setRefreshingOrder(false);
    }
  }

  async function handleCopyWalletAddress() {
    const walletAddress = checkoutInfo?.walletAddress?.trim();
    if (!walletAddress) return;

    try {
      await navigator.clipboard.writeText(walletAddress);
      setCopiedWallet(true);
    } catch (error) {
      setOrderError('复制钱包地址失败，请手动长按或选中复制。');
    }
  }

  if (authLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          正在加载支付页面...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="app-shell rounded-[32px] p-6 md:p-8">
          <header className="flex flex-col gap-5 border-b border-slate-200 pb-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Billing</div>
                  <h1 className="mt-2 text-3xl font-semibold text-slate-950">充值与支付</h1>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                  当前余额 ${balance.toFixed(2)}
                </div>
                <div className="rounded-full border border-slate-200 bg-white p-1 text-sm">
                  <button
                    onClick={() => setCurrencyMode('usd')}
                    className={`rounded-full px-3 py-1.5 ${currencyMode === 'usd' ? 'bg-[#111827] text-white' : 'text-slate-600'}`}
                  >
                    USD
                  </button>
                  <button
                    onClick={() => setCurrencyMode('cny')}
                    className={`rounded-full px-3 py-1.5 ${currencyMode === 'cny' ? 'bg-[#111827] text-white' : 'text-slate-600'}`}
                  >
                    CNY 参考
                  </button>
                </div>
              </div>
            </div>
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              海外用户优先推荐 USDT(TRC20)。创建订单后，页面下方会显示钱包地址、转账说明和下一步操作；如果中途关闭页面，也可以重新回来恢复支付指引。
            </p>
          </header>
          <section className="mt-6 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
            <div className="space-y-6">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-sky-600" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">推荐充值档位</div>
                    <div className="text-sm text-slate-500">选择常用金额，系统会自动计算赠送额度。</div>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {packages.map((pkg) => {
                    const selected = selectedAmount === pkg.amount;
                    return (
                      <button
                        key={pkg.amount}
                        onClick={() => {
                          setSelectedAmount(pkg.amount);
                          setCustomAmount('');
                        }}
                        className={`rounded-[28px] border p-5 text-left transition ${
                          selected
                            ? 'border-sky-300 bg-sky-50 shadow-[0_12px_30px_rgba(14,165,233,0.12)]'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-2xl font-semibold text-slate-950">{formatCurrency(pkg.amount, currencyMode)}</div>
                          {selected ? <Check className="h-5 w-5 text-sky-600" /> : null}
                        </div>
                        <div className="mt-2 text-sm text-slate-500">{pkg.display}</div>
                        <div className="mt-4 text-sm font-medium text-emerald-600">赠送 {formatCurrency(pkg.bonus, currencyMode)}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="text-sm font-medium text-slate-900">自定义金额</div>
                <div className="mt-2 text-sm text-slate-500">支持最低 0.01 美元。</div>
                <div className="mt-4 flex items-center gap-3 rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-slate-400">$</span>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={customAmount}
                    onChange={(event) => {
                      setCustomAmount(event.target.value);
                      setSelectedAmount(null);
                    }}
                    placeholder="输入美元金额"
                    className="w-full bg-transparent text-lg text-slate-900 outline-none placeholder:text-slate-400"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-violet-600" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">支付方式</div>
                    <div className="text-sm text-slate-500">海外用户优先推荐 USDT(TRC20)。</div>
                  </div>
                </div>
                <div className="mt-5 grid gap-3">
                  {methods.map((method) => {
                    const selected = selectedMethod === method.id;
                    return (
                      <button
                        key={method.id}
                        onClick={() => method.configured && setSelectedMethod(method.id)}
                        disabled={!method.configured}
                        className={`rounded-3xl border p-4 text-left transition ${
                          selected
                            ? 'border-sky-300 bg-sky-50 shadow-[0_12px_30px_rgba(14,165,233,0.12)]'
                            : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                        } ${!method.configured ? 'cursor-not-allowed opacity-60' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-900">{method.title}</div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${method.configured ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                              {method.statusLabel}
                            </span>
                            {selected ? <Check className="h-4 w-4 text-sky-600" /> : null}
                          </div>
                        </div>
                        <div className="mt-1 text-sm text-slate-500">{method.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <Landmark className="h-5 w-5 text-amber-600" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">订单摘要</div>
                    <div className="text-sm text-slate-500">确认金额、赠送额度与预计到账余额。</div>
                  </div>
                </div>
                <div className="mt-5 space-y-3 text-sm">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>充值金额</span>
                    <span className="font-medium text-slate-950">{formatCurrency(amount, currencyMode)}</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-500">
                    <span>赠送金额</span>
                    <span className="font-medium text-emerald-600">{formatCurrency(bonus, currencyMode)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-slate-500">
                    <span>到账总额</span>
                    <span className="text-lg font-semibold text-slate-950">{formatCurrency(amount + bonus, currencyMode)}</span>
                  </div>
                </div>
                <button
                  onClick={() => void handleCreateOrder()}
                  disabled={!amount || creatingOrder || !selectedMethodMeta?.configured}
                  className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#111827] px-5 py-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
                >
                  {creatingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                  创建充值订单
                </button>
              </div>
            </div>
          </section>

          {creationNotice ? (
            <div className="mt-6 rounded-3xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              {creationNotice}
            </div>
          ) : null}

          {lastOrder || checkoutInfo || orderMessage || orderError ? (
            <section ref={orderStatusRef} className="mt-6">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">当前订单状态</div>
                    <div className="mt-1 text-sm text-slate-500">这里会显示最近一笔订单的支付进度和下一步操作。</div>
                  </div>
                  {lastOrder?.orderNo ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => void retryOrder(lastOrder.orderNo)}
                        disabled={retryingOrder || confirmingProvider || lastOrder.paymentStatus === 'paid'}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                      >
                        {retryingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                        重新发起支付
                      </button>
                      <button
                        onClick={() => void refreshOrder(lastOrder.orderNo)}
                        disabled={refreshingOrder || confirmingProvider}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                      >
                        {refreshingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        刷新订单状态
                      </button>
                    </div>
                  ) : null}
                </div>

                {orderMessage ? <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{orderMessage}</div> : null}
                {orderError ? <div className="mt-5 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{orderError}</div> : null}
                {confirmingProvider ? (
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在确认第三方支付结果...
                  </div>
                ) : null}

                {lastOrder ? (
                  <div className="mt-5 grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Order</div>
                          <div className="mt-2 text-lg font-semibold text-slate-950">{lastOrder.orderNo}</div>
                        </div>
                        <span className={`rounded-full border px-3 py-1 text-xs font-medium ${getStatusTone(lastOrder.paymentStatus)}`}>
                          {getStatusLabel(lastOrder.paymentStatus)}
                        </span>
                      </div>

                      <div className="mt-5 space-y-3 text-sm text-slate-600">
                        <div className="flex items-center justify-between">
                          <span>支付方式</span>
                          <span className="font-medium text-slate-950 uppercase">{lastOrder.paymentMethod}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>充值金额</span>
                          <span className="font-medium text-slate-950">${Number(lastOrder.amount || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>赠送金额</span>
                          <span className="font-medium text-emerald-600">${Number(lastOrder.bonus || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                          <span>到账总额</span>
                          <span className="text-base font-semibold text-slate-950">${Number(lastOrder.total || 0).toFixed(2)}</span>
                        </div>
                        {lastOrder.transactionId ? <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">交易参考：{lastOrder.transactionId}</div> : null}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-slate-200 bg-white p-5">
                      <div className="flex items-center gap-3">
                        <ShieldCheck className="h-5 w-5 text-sky-600" />
                        <div>
                          <div className="text-sm font-medium text-slate-900">下一步操作</div>
                          <div className="text-sm text-slate-500">{lastOrder.paymentStatus === 'paid' ? '这笔订单已经到账。' : '根据当前支付方式完成付款，然后回到这里提交凭证或刷新状态。'}</div>
                        </div>
                      </div>
                      {checkoutInfo?.provider === 'usdt' ? (
                        <div className="mt-5 space-y-4">
                          <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4 text-sm text-slate-700">
                            <div className="font-medium text-slate-900">USDT 转账信息</div>
                            <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_220px]">
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div>
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Network</div>
                                    <div className="mt-1 font-medium text-slate-950">{checkoutInfo.network || 'TRC20'}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Amount</div>
                                    <div className="mt-1 font-medium text-slate-950">{checkoutInfo.amount || lastOrder.amount} {checkoutInfo.currency || 'USDT'}</div>
                                  </div>
                                </div>
                                  <div className="mt-1 flex items-center justify-between gap-3">
                                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Wallet Address</div>
                                  {checkoutInfo.walletAddress ? (
                                    <button
                                      onClick={() => void handleCopyWalletAddress()}
                                      className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-300"
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                      {copiedWallet ? '已复制' : '复制地址'}
                                    </button>
                                  ) : null}
                                </div>
                                <div className="break-all rounded-2xl border border-sky-200 bg-white px-3 py-3 font-mono text-sm text-slate-900">{checkoutInfo.walletAddress || '未返回地址，请点击重新发起支付。'}</div>
                              </div>
                              {walletQrCode ? (
                                <div className="mx-auto flex w-full max-w-[220px] flex-col items-center rounded-[28px] border border-sky-200 bg-white p-3">
                                  <img src={walletQrCode} alt="USDT 收款二维码" className="h-[190px] w-[190px] rounded-2xl" />
                                  <div className="mt-3 text-center text-xs text-slate-500">扫码向当前 TRC20 地址转账</div>
                                </div>
                              ) : (
                                <div className="mx-auto flex h-[220px] w-full max-w-[220px] items-center justify-center rounded-[28px] border border-dashed border-sky-200 bg-white text-xs text-slate-400">
                                  正在生成二维码...
                                </div>
                              )}
                            </div>
                            <div className="mt-4 text-xs text-slate-500">请严格按页面金额使用 {checkoutInfo.network || 'TRC20'} 网络转账，完成后把链上交易哈希提交到下方。</div>
                          </div>

                          {pendingOrder ? (
                            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                              <label className="text-sm font-medium text-slate-900">提交链上交易哈希</label>
                              <textarea value={txHash} onChange={(event) => setTxHash(event.target.value)} rows={3} placeholder="粘贴 TRC20 转账成功后的 tx hash" className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300" />
                              <button onClick={() => void handleSubmitUsdtHash()} disabled={refreshingOrder || !txHash.trim()} className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50">
                                {refreshingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                提交交易哈希
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {checkoutInfo?.mode === 'manual_transfer' ? (
                        <div className="mt-5 space-y-4">
                          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
                            <div className="font-medium text-slate-900">转账信息</div>
                            <div className="mt-3 grid gap-3 md:grid-cols-2">
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">收款人</div>
                                <div className="mt-1 font-medium text-slate-950">{checkoutInfo.manualDetails?.accountName || '-'}</div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">收款账号</div>
                                <div className="mt-1 break-all font-medium text-slate-950">{checkoutInfo.manualDetails?.accountNo || '-'}</div>
                              </div>
                            </div>
                            {checkoutInfo.manualDetails?.paymentLink ? <a href={checkoutInfo.manualDetails.paymentLink} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700"><ExternalLink className="h-4 w-4" />打开付款链接</a> : null}
                            {checkoutInfo.manualDetails?.recipientNote ? <div className="mt-4 rounded-2xl border border-amber-200 bg-white px-3 py-3 text-sm text-slate-600">备注说明：{checkoutInfo.manualDetails.recipientNote}</div> : null}
                          </div>

                          {pendingOrder ? (
                            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                              <label className="text-sm font-medium text-slate-900">提交付款凭证</label>
                              <textarea value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} rows={3} placeholder="填写交易号、付款备注、截图编号或人工说明" className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300" />
                              <button onClick={() => void handleSubmitManualReference()} disabled={refreshingOrder || !paymentReference.trim()} className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50">
                                {refreshingOrder ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                                提交付款凭证
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {checkoutInfo?.mode === 'redirect' && checkoutInfo.paymentUrl && pendingOrder ? <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm text-slate-600">这笔订单需要跳转到第三方支付页面继续完成。</div><a href={checkoutInfo.paymentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black"><ExternalLink className="h-4 w-4" />前往支付</a></div> : null}
                      {!checkoutInfo && pendingOrder ? <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">当前订单还未恢复出付款指引。你可以点击上方重新发起支付，系统会重新生成地址或支付说明。</div> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export default function RechargePage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]"><div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">正在加载支付页面...</div></div>}>
      <RechargePageContent />
    </Suspense>
  );
}
