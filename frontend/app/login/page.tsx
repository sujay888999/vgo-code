'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, LogIn, Mail } from 'lucide-react';
import { getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import SiteLogo from '@/components/site-logo';

type EyeTarget = {
  x: number;
  y: number;
};

type MascotTone = 'coral' | 'midnight' | 'sun' | 'violet' | 'mint';

function Character({
  className,
  eyeTarget,
  eyeScale = 1,
  blink = false,
  tone,
  children,
}: {
  className: string;
  eyeTarget: EyeTarget;
  eyeScale?: number;
  blink?: boolean;
  tone: MascotTone;
  children: React.ReactNode;
}) {
  const pupilStyle = useMemo(
    () => ({
      transform: blink ? 'translate(0px, 8px) scale(1.08, 0.2)' : `translate(${eyeTarget.x * eyeScale}px, ${eyeTarget.y * eyeScale}px)`,
    }),
    [blink, eyeScale, eyeTarget.x, eyeTarget.y],
  );

  const eyelidClass =
    tone === 'coral'
      ? 'bg-[#f97352]'
      : tone === 'midnight'
        ? 'bg-[#10151d]'
        : tone === 'sun'
          ? 'bg-[#d5bf3d]'
          : tone === 'violet'
            ? 'bg-[#6f4cff]'
            : 'bg-[#8edec7]';

  return (
    <div className={className}>
      {children}
      <div className="pointer-events-none absolute left-1/2 top-[15%] flex -translate-x-1/2 gap-5">
        {[0, 1].map((item) => (
          <div
            key={item}
            className="relative h-7 w-7 overflow-hidden rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(15,23,42,0.06),0_6px_14px_rgba(15,23,42,0.08)]"
          >
            <div
              style={pupilStyle}
              className="absolute left-[9px] top-[9px] h-3.5 w-3.5 rounded-full bg-[#111827] transition-transform duration-150"
            />
            <div
              className={`absolute inset-x-0 top-0 z-10 transition-all duration-150 ${eyelidClass}`}
              style={{ height: blink ? '100%' : '0%' }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function getLoginErrorMessage(error: any) {
  const raw = getApiErrorMessage(error, '登录失败，请稍后再试。');

  if (raw.includes('还没有注册') || raw.includes('先创建账户')) {
    return '该邮箱还没有注册，请先创建账户。';
  }

  if (raw.includes('密码错误')) {
    return '密码错误，请重新输入。';
  }

  if (raw.includes('不可用') || raw.includes('联系管理员')) {
    return '该账户当前不可用，请联系管理员。';
  }

  return raw;
}

async function loginRequest(email: string, password: string) {
  const response = await fetch('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error('LOGIN_FAILED') as any;
    error.response = { data: payload, status: response.status };
    throw error;
  }

  return payload;
}

export default function LoginPage() {
  const { setToken, setUser } = useAuthStore();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [eyeTarget, setEyeTarget] = useState<EyeTarget>({ x: 0, y: 0 });
  const [blinkMap, setBlinkMap] = useState<Record<string, boolean>>({});
  const [lastMoveAt, setLastMoveAt] = useState(Date.now());

  const blinkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blinkReleaseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (blinkTimeoutRef.current) clearTimeout(blinkTimeoutRef.current);
      if (blinkReleaseRef.current) clearTimeout(blinkReleaseRef.current);
    };
  }, []);

  useEffect(() => {
    const runBlinkLoop = () => {
      const idleFor = Date.now() - lastMoveAt;
      const nextDelay = idleFor > 1400 ? 1200 + Math.random() * 2200 : 2600 + Math.random() * 3200;

      blinkTimeoutRef.current = setTimeout(() => {
        const pool = idleFor > 1400 ? ['coral', 'violet', 'sun', 'mint'] : ['midnight'];
        const chosen = pool[Math.floor(Math.random() * pool.length)];

        setBlinkMap((prev) => ({ ...prev, [chosen]: true }));

        blinkReleaseRef.current = setTimeout(() => {
          setBlinkMap((prev) => ({ ...prev, [chosen]: false }));
          runBlinkLoop();
        }, 180);
      }, nextDelay);
    };

    runBlinkLoop();

    return () => {
      if (blinkTimeoutRef.current) clearTimeout(blinkTimeoutRef.current);
      if (blinkReleaseRef.current) clearTimeout(blinkReleaseRef.current);
    };
  }, [lastMoveAt]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await loginRequest(email, password);
      setToken(response.accessToken);
      setUser(response.user);
      window.location.href = '/chat';
    } catch (err: any) {
      setError(getLoginErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  function handlePointerMove(event: React.MouseEvent<HTMLElement>) {
    if (showPassword) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = (event.clientX - centerX) / rect.width;
    const dy = (event.clientY - centerY) / rect.height;

    setLastMoveAt(Date.now());
    setEyeTarget({
      x: Math.max(-9, Math.min(9, dx * 24)),
      y: Math.max(-6, Math.min(6, dy * 16)),
    });
  }

  function resetEyes() {
    if (!showPassword) {
      setEyeTarget({ x: 0, y: 0 });
      setLastMoveAt(Date.now());
    }
  }

  function togglePasswordVisibility() {
    setShowPassword((value) => {
      const next = !value;
      setEyeTarget(next ? { x: -8, y: 0 } : { x: 0, y: 0 });
      return next;
    });
  }

  return (
    <main
      onMouseMove={handlePointerMove}
      onMouseLeave={resetEyes}
      className="min-h-screen bg-[#f6f3ee] px-4 py-4 md:px-6 md:py-6"
    >
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1460px] overflow-hidden rounded-[36px] border border-white/80 bg-white shadow-[0_30px_100px_rgba(15,23,42,0.08)] lg:grid-cols-[1.02fr_0.98fr]">
        <section className="relative hidden overflow-hidden bg-[#1e242c] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(255,255,255,0.08),transparent_26%),radial-gradient(circle_at_80%_10%,rgba(255,215,164,0.14),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_48%)]" />
          <div className="absolute -left-16 top-14 h-44 w-44 rounded-full bg-[#f97352]/14 blur-3xl" />
          <div className="absolute right-10 top-20 h-32 w-32 rounded-full bg-[#ffe08a]/14 blur-3xl" />
          <div className="absolute bottom-8 left-10 h-40 w-40 rounded-full bg-[#7c62ff]/14 blur-3xl" />

          <div className="relative flex h-full flex-col p-10">
            <div className="flex items-center gap-3 text-white">
              <SiteLogo size="lg" priority />
              <div className="text-sm font-medium tracking-[0.08em] text-white/90">VGO AI</div>
            </div>

            <div className="mt-12 max-w-[420px] text-white">
              <h1 className="text-[58px] font-semibold leading-[0.92] tracking-[-0.07em]">VGO AI</h1>
              <p className="mt-4 text-xl font-medium tracking-[0.02em] text-white/78">你的智能工作台</p>
            </div>

            <div className="relative mx-auto mt-auto h-[560px] w-full max-w-[600px]">
              <div className="login-float-soft absolute left-[18px] top-[44px] h-16 w-16 rounded-[20px] border border-white/10 bg-white/6 backdrop-blur-sm" />
              <div className="login-float absolute right-[24px] top-[36px] h-10 w-10 rounded-full border border-white/10 bg-[#8edec7]/20" />
              <div className="login-float-delayed absolute right-[96px] top-[124px] h-5 w-24 rounded-full bg-white/8" />

              <Character
                className="login-float absolute bottom-[20px] left-[0px] h-[194px] w-[212px]"
                eyeTarget={eyeTarget}
                eyeScale={1.1}
                blink={!!blinkMap.coral}
                tone="coral"
              >
                <div className="absolute inset-0 rounded-[34px] bg-[linear-gradient(180deg,#ff9c7a_0%,#f97352_100%)] shadow-[0_22px_40px_rgba(249,115,82,0.28)]" />
                <div className="absolute inset-x-[18px] top-[18px] h-[48px] rounded-[22px] bg-white/12" />
                <div className="absolute bottom-[32px] left-1/2 h-[5px] w-10 -translate-x-1/2 rounded-full bg-[#111827]/55" />
              </Character>

              <Character
                className="login-float-delayed absolute bottom-[118px] left-[152px] h-[248px] w-[134px]"
                eyeTarget={eyeTarget}
                eyeScale={0.96}
                blink={!!blinkMap.violet}
                tone="violet"
              >
                <div className="absolute inset-0 rotate-[-8deg] rounded-[30px] bg-[linear-gradient(180deg,#7d67ff_0%,#5a38f2_100%)] shadow-[0_24px_44px_rgba(90,56,242,0.24)]" />
                <div className="absolute right-[20px] top-[24px] h-10 w-10 rounded-full bg-white/12" />
                <div className="absolute bottom-[42px] left-1/2 h-[4px] w-4 -translate-x-1/2 rounded-full bg-white/55" />
              </Character>

              <Character
                className="login-float absolute bottom-[58px] left-[276px] h-[220px] w-[122px]"
                eyeTarget={eyeTarget}
                eyeScale={0.88}
                blink={!!blinkMap.midnight}
                tone="midnight"
              >
                <div className="absolute inset-0 [clip-path:polygon(16%_0%,100%_0%,84%_100%,0%_100%)] rounded-[24px] bg-[linear-gradient(180deg,#1d2229_0%,#0c1015_100%)] shadow-[0_22px_42px_rgba(0,0,0,0.26)]" />
                <div className="absolute inset-x-[18px] top-[18px] h-[18px] rounded-full bg-white/10" />
                <div className="absolute bottom-[40px] left-1/2 h-[4px] w-5 -translate-x-1/2 rounded-full bg-white/45" />
              </Character>

              <Character
                className="login-float-soft absolute bottom-[6px] left-[374px] h-[204px] w-[162px]"
                eyeTarget={eyeTarget}
                eyeScale={0.82}
                blink={!!blinkMap.sun}
                tone="sun"
              >
                <div className="absolute inset-0 rounded-[42px] bg-[linear-gradient(180deg,#f0dc6d_0%,#ceb33d_100%)] shadow-[0_24px_42px_rgba(208,176,55,0.26)]" />
                <div className="absolute inset-x-[20px] bottom-[22px] top-[22px] rounded-[34px] border border-[#111827]/12" />
                <div className="absolute right-[20px] top-[26px] h-9 w-9 rounded-full bg-white/14" />
                <div className="absolute bottom-[50px] left-1/2 h-[4px] w-10 -translate-x-1/2 rounded-full bg-[#111827]/68" />
              </Character>

              <Character
                className="login-float-delayed absolute bottom-[198px] right-[18px] h-[126px] w-[126px]"
                eyeTarget={eyeTarget}
                eyeScale={0.68}
                blink={!!blinkMap.mint}
                tone="mint"
              >
                <div className="absolute inset-0 rounded-[32px] bg-[linear-gradient(180deg,#a7eedb_0%,#72d6b7_100%)] shadow-[0_20px_36px_rgba(114,214,183,0.2)]" />
                <div className="absolute inset-[16px] rounded-[24px] border border-white/30" />
              </Character>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center bg-[linear-gradient(180deg,#fffdfa_0%,#ffffff_100%)] px-6 py-8 md:px-10">
          <div className="w-full max-w-[430px]">
            <div className="mb-10 lg:hidden">
              <div className="flex items-center gap-3">
                <SiteLogo size="lg" priority />
                <div className="text-sm font-medium tracking-[0.08em] text-slate-500">VGO AI</div>
              </div>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center rounded-full border border-[#eadfd2] bg-[#faf4ec] px-4 py-2 text-xs tracking-[0.18em] text-[#8b6d54]">
                WORKSPACE ACCESS
              </div>
              <h1 className="mt-6 text-[40px] font-semibold tracking-[-0.05em] text-slate-950">登录 VGO AI</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">输入你的账户信息，继续进入智能工作台。</p>
            </div>

            <form onSubmit={handleSubmit} className="mt-10 space-y-4">
              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-700">
                  {error}
                </div>
              ) : null}

              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">邮箱</div>
                <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                  <Mail className="h-4 w-4 text-slate-400" />
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                    required
                  />
                </div>
              </label>

              <label className="block">
                <div className="mb-2 text-sm font-medium text-slate-700">密码</div>
                <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3.5 shadow-[0_8px_20px_rgba(15,23,42,0.05)] transition focus-within:border-slate-400">
                  <Lock className="h-4 w-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
                    required
                  />
                  <button
                    type="button"
                    onClick={togglePasswordVisibility}
                    className="text-slate-400 transition hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </label>

              <div className="flex items-center justify-between px-1 text-sm">
                <label className="flex items-center gap-2 text-slate-500">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300" />
                  30 天内记住我
                </label>
                <span className="text-slate-400">忘记密码</span>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#121821] px-5 py-3.5 text-sm font-medium text-white shadow-[0_14px_28px_rgba(15,23,42,0.12)] transition hover:bg-black disabled:opacity-50"
              >
                <LogIn className="h-4 w-4" />
                {loading ? '登录中...' : '登录'}
              </button>
            </form>

            <div className="mt-8 text-center text-sm text-slate-500">
              还没有账户？
              <Link href="/register" className="ml-1 font-medium text-slate-950 transition hover:text-black">
                去注册
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
