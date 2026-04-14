'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  Receipt,
  Save,
  Trash2,
  UserCircle2,
  Wallet,
  X,
} from 'lucide-react';
import { authApi, chatApi, gatewayApi, getApiErrorMessage, rechargeApi, userApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface ApiKeyRecord {
  id: string;
  apiKey: string;
  name: string;
  dailyLimit: number;
  monthlyLimit: number;
  usedToday: number;
  usedMonth: number;
}

interface RechargeRecord {
  id: string;
  orderNo: string;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  createdAt: string;
}

interface ProfileResponse {
  id: string;
  email: string;
  username: string;
  balance: number;
  isAdmin: boolean;
}

interface ChatStats {
  today: number;
  total: number;
  totalCost: number;
}

interface UsagePoint {
  date: string;
  count: string | number;
  tokens: string | number;
  cost: string | number;
}

function PasswordField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-slate-900 outline-none placeholder:text-slate-400"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const normalized = String(status || '').toLowerCase();
  const styles =
    normalized === 'paid' || normalized === 'completed' || normalized === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : normalized === 'pending'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-slate-200 bg-slate-50 text-slate-600';

  const label = normalized === 'paid' ? '已到账' : normalized === 'pending' ? '待确认' : status || '未知';

  return <span className={`rounded-full border px-2.5 py-1 text-xs ${styles}`}>{label}</span>;
}

export default function DashboardPage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth, logout, setUser } = useAuthStore();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [balance, setBalance] = useState(0);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [rechargeHistory, setRechargeHistory] = useState<RechargeRecord[]>([]);
  const [chatStats, setChatStats] = useState<ChatStats>({ today: 0, total: 0, totalCost: 0 });
  const [usageStats, setUsageStats] = useState<UsagePoint[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [profileEmail, setProfileEmail] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

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

  const usageSummary = useMemo(
    () =>
      usageStats.reduce(
        (acc, item) => {
          acc.requests += Number(item.count || 0);
          acc.tokens += Number(item.tokens || 0);
          acc.cost += Number(item.cost || 0);
          return acc;
        },
        { requests: 0, tokens: 0, cost: 0 },
      ),
    [usageStats],
  );

  async function loadData() {
    setLoading(true);
    try {
      const [keysRes, balanceRes, historyRes, profileRes, chatStatsRes, usageStatsRes] = await Promise.all([
        authApi.getApiKeys(),
        userApi.getBalance(),
        rechargeApi.getHistory(1, 6),
        userApi.getProfile(),
        chatApi.getStats(),
        gatewayApi.getUsageStats(7),
      ]);

      const profile = profileRes.data as ProfileResponse;
      const nextKeys = Array.isArray(keysRes.data) ? keysRes.data : keysRes.data?.data || [];
      const nextHistory = historyRes.data?.data || historyRes.data || [];
      const nextChatStats = chatStatsRes.data?.data || chatStatsRes.data || { today: 0, total: 0, totalCost: 0 };
      const nextUsageStats = usageStatsRes.data?.data || usageStatsRes.data || [];

      setApiKeys(nextKeys);
      setBalance(Number(balanceRes.data?.balance || 0));
      setRechargeHistory(nextHistory);
      setProfileEmail(profile.email || '');
      setProfileUsername(profile.username || '');
      setChatStats(nextChatStats);
      setUsageStats(nextUsageStats);
      setUser(profile);
    } catch (error) {
      console.error('Failed to load dashboard data', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProfile() {
    setProfileMessage('');
    setProfileError('');

    if (!profileEmail.trim() || !profileUsername.trim()) {
      setProfileError('请完整填写用户名和邮箱。');
      return;
    }

    setSavingProfile(true);
    try {
      const response = await userApi.updateProfile({
        email: profileEmail.trim(),
        username: profileUsername.trim(),
      });
      setUser(response.data);
      setProfileMessage('资料已更新。');
    } catch (error: any) {
      setProfileError(getApiErrorMessage(error, '保存资料失败，请稍后重试。'));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    setPasswordMessage('');
    setPasswordError('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('请完整填写密码信息。');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError('新密码至少 6 位。');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致。');
      return;
    }

    setChangingPassword(true);
    try {
      const response = await userApi.changePassword({ currentPassword, newPassword });
      setPasswordMessage(response.data.message || '密码修改成功。');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setPasswordError(getApiErrorMessage(error, '修改密码失败，请稍后重试。'));
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleCreateApiKey() {
    setApiKeyMessage('');
    setApiKeyError('');

    if (!newKeyName.trim()) {
      setApiKeyError('请先填写密钥名称。');
      return;
    }

    setCreatingKey(true);
    try {
      const response = await authApi.createApiKey({ name: newKeyName.trim() });
      const createdKey = response.data?.apiKey || response.data?.data?.apiKey;
      setApiKeyMessage(createdKey ? `密钥已创建：${createdKey}` : 'API Key 已创建。');
      setNewKeyName('');
      await loadData();
    } catch (error: any) {
      setApiKeyError(getApiErrorMessage(error, '创建 API Key 失败，请稍后重试。'));
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleDeleteApiKey(id: string) {
    try {
      await authApi.deleteApiKey(id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete API key', error);
    }
  }

  async function handleCopyApiKey(apiKey: string, id: string) {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch (error) {
      console.error('Failed to copy API key', error);
    }
  }

  function handleLogout() {
    logout();
    router.replace('/');
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          正在加载账户中心...
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
                  href="/chat"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Account Center</div>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">{user?.username || 'VGO AI'}</h1>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                  余额 ${balance.toFixed(2)}
                </div>
                <Link
                  href="/recharge"
                  className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-3 text-sm font-medium text-white transition hover:bg-black"
                >
                  <Wallet className="h-4 w-4" />
                  立即充值
                </Link>
                <button
                  onClick={handleLogout}
                  className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="max-w-2xl text-sm leading-6 text-slate-600">
              在这里维护账户资料、管理 API Key、查看充值订单和最近 7 天的使用情况。
            </p>
          </header>

          <section className="mt-6 grid gap-6 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-3">
                <UserCircle2 className="h-5 w-5 text-slate-700" />
                <div>
                  <div className="text-sm font-medium text-slate-900">个人资料</div>
                  <div className="text-sm text-slate-500">修改用户名和登录邮箱。</div>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <input
                  value={profileUsername}
                  onChange={(event) => setProfileUsername(event.target.value)}
                  placeholder="用户名"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400"
                />
                <input
                  value={profileEmail}
                  onChange={(event) => setProfileEmail(event.target.value)}
                  placeholder="邮箱"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400"
                />

                {profileMessage ? (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                    {profileMessage}
                  </div>
                ) : null}

                {profileError ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {profileError}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => void handleSaveProfile()}
                    disabled={savingProfile}
                    className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {savingProfile ? '保存中...' : '保存资料'}
                  </button>

                  <button
                    onClick={() => {
                      setPasswordMessage('');
                      setPasswordError('');
                      setPasswordModalOpen(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:border-slate-300"
                  >
                    <Lock className="h-4 w-4" />
                    修改密码
                  </button>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 text-slate-700" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">今日对话</div>
                    <div className="text-sm text-slate-500">当天累计消息数。</div>
                  </div>
                </div>
                <div className="mt-6 text-3xl font-semibold text-slate-950">{chatStats.today}</div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <Receipt className="h-5 w-5 text-slate-700" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">累计对话</div>
                    <div className="text-sm text-slate-500">总消息使用量。</div>
                  </div>
                </div>
                <div className="mt-6 text-3xl font-semibold text-slate-950">{chatStats.total}</div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-slate-700" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">近 7 天成本</div>
                    <div className="text-sm text-slate-500">按网关日志汇总。</div>
                  </div>
                </div>
                <div className="mt-6 text-3xl font-semibold text-slate-950">${usageSummary.cost.toFixed(2)}</div>
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 text-slate-700" />
                  <div>
                    <div className="text-sm font-medium text-slate-900">近 7 天 Token</div>
                    <div className="text-sm text-slate-500">输入与输出总量。</div>
                  </div>
                </div>
                <div className="mt-6 text-3xl font-semibold text-slate-950">{usageSummary.tokens.toLocaleString()}</div>
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1.02fr_0.98fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-3">
                <KeyRound className="h-5 w-5 text-slate-700" />
                <div>
                  <div className="text-sm font-medium text-slate-900">API 密钥</div>
                  <div className="text-sm text-slate-500">一个密钥可调用站内所有已开放模型。</div>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <input
                  value={newKeyName}
                  onChange={(event) => setNewKeyName(event.target.value)}
                  placeholder="例如：主账户调用"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  onClick={() => void handleCreateApiKey()}
                  disabled={creatingKey}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#111827] px-4 py-3 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  创建
                </button>
              </div>

              {apiKeyMessage ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {apiKeyMessage}
                </div>
              ) : null}

              {apiKeyError ? (
                <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {apiKeyError}
                </div>
              ) : null}

              <div className="mt-5 space-y-3">
                {apiKeys.length ? (
                  apiKeys.map((item) => (
                    <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900">{item.name}</div>
                          <div className="mt-2 truncate font-mono text-xs text-slate-500">{item.apiKey}</div>
                          <div className="mt-3 text-xs text-slate-500">
                            今日 {item.usedToday} / 月度 {item.usedMonth}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => void handleCopyApiKey(item.apiKey, item.id)}
                            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-slate-900"
                          >
                            {copiedId === item.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                          </button>
                          <button
                            onClick={() => void handleDeleteApiKey(item.id)}
                            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    当前还没有 API Key，先创建一个再接入你的应用。
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-3">
                <Receipt className="h-5 w-5 text-slate-700" />
                <div>
                  <div className="text-sm font-medium text-slate-900">最近充值订单</div>
                  <div className="text-sm text-slate-500">保留最近几笔充值记录。</div>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {rechargeHistory.length ? (
                  rechargeHistory.map((item) => (
                    <div key={item.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-slate-900">{item.orderNo}</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {new Date(item.createdAt).toLocaleString()} · {item.paymentMethod}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-slate-900">${Number(item.total || 0).toFixed(2)}</div>
                          <div className="mt-1">
                            <StatusBadge status={item.paymentStatus} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                    还没有充值记录，点击上方“立即充值”即可创建第一笔订单。
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {passwordModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4">
          <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_28px_90px_rgba(15,23,42,0.12)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold text-slate-950">修改密码</div>
                <div className="mt-1 text-sm text-slate-500">先输入当前密码，再设置新的登录密码。</div>
              </div>
              <button
                onClick={() => setPasswordModalOpen(false)}
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <PasswordField value={currentPassword} onChange={setCurrentPassword} placeholder="当前密码" />
              <PasswordField value={newPassword} onChange={setNewPassword} placeholder="新密码" />
              <PasswordField value={confirmPassword} onChange={setConfirmPassword} placeholder="确认新密码" />

              {passwordMessage ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                  {passwordMessage}
                </div>
              ) : null}

              {passwordError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {passwordError}
                </div>
              ) : null}

              <div className="flex gap-3">
                <button
                  onClick={() => void handleChangePassword()}
                  disabled={changingPassword}
                  className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-50"
                >
                  <Lock className="h-4 w-4" />
                  {changingPassword ? '更新中...' : '更新密码'}
                </button>

                <button
                  onClick={() => setPasswordModalOpen(false)}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300"
                >
                  <X className="h-4 w-4" />
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
