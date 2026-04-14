'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ArrowRight, Brain, CreditCard, Shield, Users } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface DashboardStats {
  users: { total: number; active: number };
  balance: { total: number };
  recharges: { total: number };
  requests: { today: number; month: number };
  cost: { total: number };
  conversations: { today: number; total: number };
}

export default function AdminDashboardPage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

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
      void loadStats();
    }
  }, [isAuthenticated, user]);

  async function loadStats() {
    try {
      const response = await adminApi.getDashboard();
      setStats(response.data);
    } catch (error) {
      console.error('Failed to load admin dashboard stats', error);
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || loading || !stats) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          正在加载管理后台...
        </div>
      </div>
    );
  }

  const cards = [
    { label: '用户总数', value: stats.users.total, sub: `${stats.users.active} 个活跃用户`, icon: Users },
    { label: '今日请求', value: stats.requests.today, sub: `本月 ${stats.requests.month}`, icon: Activity },
    { label: '累计充值', value: `$${stats.recharges.total.toFixed(2)}`, sub: `累计成本 $${stats.cost.total.toFixed(4)}`, icon: CreditCard },
    { label: '会话总数', value: stats.conversations.total, sub: `今日新增 ${stats.conversations.today}`, icon: Brain },
  ];

  const links = [
    { href: '/admin/channels', title: '渠道管理', description: '管理模型路由、渠道状态和接口配置。' },
    { href: '/admin/users', title: '用户管理', description: '查看账户状态、余额和权限信息。' },
    { href: '/admin/logs', title: '请求日志', description: '排查调用情况、耗时、异常和模型使用记录。' },
    { href: '/admin/recharges', title: '支付订单', description: '查看充值记录、支付状态和人工审核订单。' },
  ];

  return (
    <main className="min-h-screen px-4 py-4 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="app-shell rounded-[32px] p-6 md:p-8">
          <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Admin Console</div>
              <h1 className="mt-2 text-3xl font-semibold text-slate-950">平台运营总览</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              把用户、会话、请求、充值和渠道状态放到同一个后台里，便于持续运营 VGO AI。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                管理员权限已启用
              </div>
              <Link href="/chat" className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-slate-300">
                返回工作台
              </Link>
            </div>
          </header>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.label} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm text-slate-500">{card.label}</div>
                      <div className="mt-3 text-3xl font-semibold text-slate-950">{card.value}</div>
                      <div className="mt-2 text-sm text-slate-500">{card.sub}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <Icon className="h-5 w-5 text-slate-700" />
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_0.92fr]">
            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">收入与余额概览</div>
              <div className="mt-2 text-sm text-slate-500">
                用于快速判断当前平台的充值规模、用户余额沉淀和整体成本情况。
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">用户余额</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">${stats.balance.total.toFixed(2)}</div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">累计充值</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">${stats.recharges.total.toFixed(2)}</div>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm text-slate-500">累计成本</div>
                  <div className="mt-2 text-2xl font-semibold text-slate-950">${stats.cost.total.toFixed(4)}</div>
                </div>
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-emerald-600" />
                <div>
                  <div className="text-sm font-medium text-slate-900">常用后台入口</div>
                  <div className="text-sm text-slate-500">把高频运维动作集中到一个区域里。</div>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                {links.map((link) => (
                  <Link key={link.href} href={link.href} className="flex items-center justify-between rounded-3xl border border-slate-200 bg-slate-50 p-4 transition hover:border-slate-300 hover:bg-white">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{link.title}</div>
                      <div className="mt-1 text-sm text-slate-500">{link.description}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
