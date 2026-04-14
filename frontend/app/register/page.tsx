'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Lock, Mail, Send, User, UserPlus } from 'lucide-react';
import { authApi, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import SiteLogo from '@/components/site-logo';

const CODE_COOLDOWN_SECONDS = 60;
const IDEAL_USERS = [
  '独立开发者：想快速接入 GPT、Claude、Gemini 等模型，少折腾账号、支付和线路。',
  'AI 工具团队：需要统一模型入口、在线充值和稳定调用，方便把产品尽快推上线。',
  '出海创业者：要把模型能力接进内容、客服、自动化流程，直接服务全球用户。',
];
const VALUE_POINTS = ['多模型聚合接入', '在线充值即开即用', '更适合做真实业务'];

function getRegisterErrorMessage(error: any) {
  const raw = getApiErrorMessage(error, '注册失败，请稍后再试。');

  if (raw.includes('已经注册') || raw.includes('Email already exists')) {
    return '该邮箱已经注册过，请直接登录。';
  }
  if (raw.includes('邮箱') && raw.includes('格式')) {
    return '邮箱格式不正确，请检查后重新提交。';
  }
  if (raw.includes('用户名')) {
    return '用户名不符合要求，请修改后重试。';
  }
  if (raw.includes('验证码') || raw.includes('密码')) {
    return raw;
  }

  return raw;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function maskEmail(value: string) {
  const email = value.trim();
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return email;
  if (localPart.length <= 2) return `${localPart[0] || '*'}*@${domain}`;
  return `${localPart.slice(0, 2)}***${localPart.slice(-1)}@${domain}`;
}

export default function RegisterPage() {
  const { setToken, setUser } = useAuthStore();
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const sendCodeLabel = useMemo(() => {
    if (sendingCode) return '发送中...';
    if (cooldown > 0) return `${cooldown}s 后重发`;
    return '发送验证码';
  }, [cooldown, sendingCode]);

  const sendCodeHint = useMemo(() => {
    if (!email.trim()) return '先填写邮箱，再获取 6 位验证码。';
    if (cooldown > 0) return `验证码已发送到 ${maskEmail(email)}，请查看收件箱或垃圾邮箱。`;
    return `验证码会发送到 ${maskEmail(email)}。`;
  }, [cooldown, email]);

  async function handleSendCode() {
    setError('');
    setInfo('');

    if (!isValidEmail(email)) {
      setError('请先输入正确的邮箱地址。');
      return;
    }

    setSendingCode(true);
    try {
      await authApi.sendRegistrationCode(email);
      setInfo(`验证码已发送到 ${maskEmail(email)}，请留意邮箱，10 分钟内有效。`);
      setCooldown(CODE_COOLDOWN_SECONDS);
    } catch (err: any) {
      setError(getRegisterErrorMessage(err));
    } finally {
      setSendingCode(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setInfo('');

    if (!isValidEmail(email)) {
      setError('请输入正确的邮箱地址。');
      return;
    }

    if (!verificationCode.trim()) {
      setError('请先输入邮箱验证码。');
      return;
    }

    if (password !== confirmPassword) {
      setError('两次输入的密码不一致。');
      return;
    }

    if (password.length < 6) {
      setError('密码长度至少需要 6 位。');
      return;
    }

    setLoading(true);
    try {
      const response = await authApi.register({
        email,
        username,
        password,
        verificationCode,
      });
      setToken(response.data.accessToken);
      setUser(response.data.user);
      window.location.href = '/chat';
    } catch (err: any) {
      setError(getRegisterErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f0e8] px-4 py-4 md:px-6 md:py-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1460px] overflow-hidden rounded-[36px] border border-white/75 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.08)] lg:grid-cols-[1.06fr_0.94fr]">
        <section className="relative hidden overflow-hidden bg-[#f1ece3] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(255,255,255,0.88),transparent_24%),radial-gradient(circle_at_88%_12%,rgba(17,24,39,0.06),transparent_22%),linear-gradient(180deg,#f7f1e7_0%,#ece3d7_100%)]" />
          <div className="absolute left-10 top-10 flex items-center gap-3">
            <SiteLogo size="lg" priority />
            <div className="text-sm font-medium tracking-[0.08em] text-slate-500">VGO AI</div>
          </div>

          <div className="relative flex h-full flex-col p-10">
            <div className="max-w-[420px]">
              <div className="inline-flex items-center rounded-full border border-black/10 bg-white/70 px-4 py-2 text-[11px] tracking-[0.22em] text-slate-500">
                精准用户入口
              </div>
              <h1 className="mt-6 text-[56px] font-semibold leading-[0.92] tracking-[-0.07em] text-slate-950">
                VGO AI
              </h1>
              <p className="hidden">
                简洁开始，智能接管。
              </p>
              <p className="mt-4 text-base leading-7 text-slate-500">
                给开发者、AI 产品团队和出海创业者准备的模型调用平台。
              </p>
            </div>

            <div className="mt-8 max-w-[480px] rounded-[32px] border border-black/8 bg-white/72 p-6 shadow-[0_18px_48px_rgba(15,23,42,0.06)] backdrop-blur-sm">
              <div className="text-xs uppercase tracking-[0.2em] text-slate-500">谁最适合现在注册</div>
              <div className="mt-4 space-y-3">
                {IDEAL_USERS.map((item) => (
                  <div
                    key={item}
                    className="rounded-[22px] border border-black/6 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700"
                  >
                    {item}
                  </div>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {VALUE_POINTS.map((item) => (
                  <span
                    key={item}
                    className="rounded-full border border-black/8 bg-[#f7f1e7] px-3 py-1.5 text-xs text-slate-600"
                  >
                    {item}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-500">
                如果你是来做产品、跑业务、接 API、做全球用户生意，而不是只想随便试试，这里就是你的入口。
              </p>
            </div>

            <div className="relative mx-auto mt-auto h-[560px] w-full max-w-[620px]">
              <div className="register-orbit-slow absolute left-[26px] top-[18px] h-20 w-20 rounded-full border border-black/8 bg-white/50 backdrop-blur-sm" />
              <div className="register-orbit-fast absolute right-[54px] top-[42px] h-10 w-10 rounded-full bg-[#111827]" />
              <div className="register-orbit-soft absolute right-[120px] top-[134px] h-4 w-28 rounded-full bg-black/8" />

              <div className="absolute left-[68px] top-[112px] h-[318px] w-[470px] rounded-[44px] border border-black/8 bg-white/55 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-xl" />
              <div className="absolute left-[96px] top-[142px] h-[258px] w-[410px] rounded-[34px] border border-black/6 bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(248,245,240,0.56))] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" />

              <div className="register-orbit-slow absolute left-[132px] top-[176px] h-10 w-10 rounded-[16px] bg-[#111827]" />
              <div className="register-orbit-fast absolute left-[200px] top-[180px] h-12 w-24 rounded-[20px] bg-white shadow-[0_10px_26px_rgba(15,23,42,0.08)]" />
              <div className="register-orbit-soft absolute right-[138px] top-[182px] h-14 w-14 rounded-full border border-black/8 bg-[#f2eadf]" />

              <div className="absolute left-[146px] top-[244px] h-[2px] w-[280px] bg-[linear-gradient(90deg,rgba(17,24,39,0.12),rgba(17,24,39,0.02))]" />
              <div className="absolute left-[166px] top-[240px] h-3 w-3 rounded-full bg-[#111827]" />
              <div className="register-pulse-dot absolute left-[264px] top-[238px] h-4 w-4 rounded-full bg-[#6e8b74]" />
              <div className="register-pulse-dot-delayed absolute left-[378px] top-[238px] h-4 w-4 rounded-full bg-[#c79c5c]" />

              <div className="absolute left-[132px] top-[284px] grid w-[350px] grid-cols-3 gap-4">
                <div className="register-card-rise h-28 rounded-[26px] border border-black/8 bg-white/90 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
                  <div className="h-3 w-16 rounded-full bg-black/10" />
                  <div className="mt-8 h-12 rounded-[18px] bg-[#111827]" />
                </div>
                <div className="register-card-rise-delayed h-32 rounded-[28px] border border-black/8 bg-[#111827] p-4 shadow-[0_18px_36px_rgba(15,23,42,0.14)]">
                  <div className="h-3 w-12 rounded-full bg-white/18" />
                  <div className="mt-10 h-12 rounded-[18px] bg-white/10" />
                </div>
                <div className="register-card-rise-soft h-24 rounded-[24px] border border-black/8 bg-[#efe7db] p-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
                  <div className="h-3 w-14 rounded-full bg-black/10" />
                  <div className="mt-6 h-10 rounded-[16px] bg-white/70" />
                </div>
              </div>

              <div className="absolute left-[74px] bottom-[60px] h-24 w-24 rounded-full border border-black/8 bg-white/60 backdrop-blur-sm" />
              <div className="absolute right-[38px] bottom-[24px] h-[110px] w-[220px] rounded-[34px] border border-black/8 bg-white/70 p-5 shadow-[0_18px_40px_rgba(15,23,42,0.06)] backdrop-blur-sm">
                <div className="h-3 w-20 rounded-full bg-black/10" />
                <div className="mt-6 h-14 rounded-[18px] bg-[linear-gradient(90deg,#111827_0%,#2f3947_100%)]" />
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-[linear-gradient(180deg,#fffdfa_0%,#ffffff_100%)] px-6 py-8 md:px-10">
          <div className="w-full max-w-[460px]">
            <div className="mb-10 lg:hidden">
              <div className="flex items-center gap-3">
                <SiteLogo size="lg" priority />
                <div className="text-sm font-medium tracking-[0.08em] text-slate-500">VGO AI</div>
              </div>
            </div>

            <div>
              <div className="inline-flex items-center rounded-full border border-[#eadfd2] bg-[#faf4ec] px-4 py-2 text-xs tracking-[0.18em] text-[#8b6d54]">
                START HERE
              </div>
              <h2 className="mt-5 text-[40px] font-semibold tracking-[-0.05em] text-slate-950">注册 VGO AI</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                先完成邮箱验证，再创建账户并进入你的智能工作台。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              {error ? <div className="rounded-3xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-700">{error}</div> : null}
              {info ? <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-700">{info}</div> : null}

              <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="邮箱地址"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                    required
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div className="rounded-[28px] border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                  <div className="flex items-center gap-3">
                    <Send className="h-4 w-4 text-slate-400" />
                    <input
                      value={verificationCode}
                      onChange={(event) => setVerificationCode(event.target.value)}
                      placeholder="邮箱验证码"
                      className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                      inputMode="numeric"
                      maxLength={6}
                      required
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={sendingCode || cooldown > 0}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3.5 text-sm font-medium text-slate-700 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition hover:border-slate-300 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {sendCodeLabel}
                </button>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500">
                {sendCodeHint}
              </div>

              <div className="rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-slate-400" />
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="用户名"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                    required
                  />
                </div>
              </div>

              <div className="rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                <div className="flex items-center gap-3">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="密码"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                    required
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="text-slate-400 transition hover:text-slate-700">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                <div className="flex items-center gap-3">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="确认密码"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                    required
                  />
                  <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} className="text-slate-400 transition hover:text-slate-700">
                    {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#121821] px-5 py-3.5 text-sm font-medium text-white shadow-[0_14px_28px_rgba(15,23,42,0.12)] transition hover:bg-black disabled:opacity-50"
              >
                <UserPlus className="h-4 w-4" />
                {loading ? '注册中...' : '完成注册'}
              </button>
            </form>

            <div className="mt-6 flex items-center justify-between text-sm text-slate-500">
              <Link href="/login" className="font-medium text-slate-900 transition hover:text-black">
                已有账户？去登录
              </Link>
              <Link href="/" className="inline-flex items-center gap-1 transition hover:text-slate-900">
                返回首页
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
