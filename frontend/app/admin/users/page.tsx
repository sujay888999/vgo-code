'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, Shield, UserCheck, UserX, Users } from 'lucide-react';
import { adminApi } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface UserRecord {
  id: string;
  email: string;
  username: string;
  balance: number;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const router = useRouter();
  const [records, setRecords] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

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
      void loadUsers();
    }
  }, [isAuthenticated, user, page, search]);

  async function loadUsers() {
    try {
      const response = await adminApi.getUsers(page, 10, search);
      setRecords(response.data.data || []);
      setTotalPages(response.data.totalPages || 1);
    } catch (error) {
      console.error('Failed to load users', error);
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(record: UserRecord) {
    try {
      await adminApi.updateUser(record.id, { isActive: !record.isActive });
      await loadUsers();
    } catch (error) {
      console.error('Failed to update user status', error);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          正在加载用户列表...
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
              <Link href="/admin" className="rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Accounts</div>
                <h1 className="mt-2 text-3xl font-semibold text-slate-950">用户管理</h1>
              </div>
            </div>
            <div className="rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700">
              当前页 {records.length} 个用户
            </div>
          </header>

          <section className="mt-6">
            <div className="flex max-w-xl items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                placeholder="按邮箱或用户名搜索"
                className="w-full bg-transparent text-slate-900 outline-none placeholder:text-slate-400"
              />
            </div>
          </section>

          <section className="mt-6 overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
            <div className="grid grid-cols-[1.6fr_0.8fr_0.7fr_0.7fr] gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 text-xs uppercase tracking-[0.18em] text-slate-500">
              <div>用户</div>
              <div>余额</div>
              <div>角色</div>
              <div>状态</div>
            </div>

            <div className="divide-y divide-slate-200">
              {records.map((record) => (
                <div key={record.id} className="grid grid-cols-[1.6fr_0.8fr_0.7fr_0.7fr] gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900">{record.username}</div>
                    <div className="mt-1 truncate text-sm text-slate-500">{record.email}</div>
                    <div className="mt-1 text-xs text-slate-400">注册于 {new Date(record.createdAt).toLocaleDateString()}</div>
                  </div>
                  <div className="self-center text-sm text-slate-900">${Number(record.balance).toFixed(2)}</div>
                  <div className="self-center">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${record.isAdmin ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-700'}`}>
                      {record.isAdmin ? <Shield className="h-3 w-3" /> : <Users className="h-3 w-3" />}
                      {record.isAdmin ? '管理员' : '普通用户'}
                    </span>
                  </div>
                  <div className="self-center">
                    <button
                      onClick={() => void toggleActive(record)}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${record.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
                    >
                      {record.isActive ? <UserCheck className="h-3 w-3" /> : <UserX className="h-3 w-3" />}
                      {record.isActive ? '已启用' : '已禁用'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6 flex items-center justify-center gap-3">
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-slate-300 disabled:opacity-40">
              上一页
            </button>
            <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600">
              第 {page} / {totalPages} 页
            </div>
            <button onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 transition hover:border-slate-300 disabled:opacity-40">
              下一页
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
