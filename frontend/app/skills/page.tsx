'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Check, Loader2, Sparkles } from 'lucide-react';
import { chatApi, getApiErrorMessage } from '@/lib/api';
import { normalizeInstalledSkillIds } from '@/lib/skills';
import { useAuthStore } from '@/lib/store';

interface SkillRecord {
  id: string;
  name: string;
  description: string;
  installed?: boolean;
}

export default function SkillsPage() {
  const { isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [installedSkillIds, setInstalledSkillIds] = useState<string[]>(['general-agent']);
  const [loading, setLoading] = useState(true);
  const [savingSkillId, setSavingSkillId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadSkills();
  }, [isAuthenticated]);

  async function loadSkills() {
    setLoading(true);
    setError('');

    try {
      const response = await chatApi.getSkills();
      const nextSkills = response.data.data as SkillRecord[];
      setSkills(nextSkills);
      setInstalledSkillIds(normalizeInstalledSkillIds(nextSkills.filter((skill) => skill.installed).map((skill) => skill.id)));
    } catch (error: any) {
      setError(getApiErrorMessage(error, '加载技能列表失败，请稍后再试。'));
    } finally {
      setLoading(false);
    }
  }

  async function toggleInstall(skillId: string) {
    if (skillId === 'general-agent' || savingSkillId) return;

    const next = installedSkillIds.includes(skillId)
      ? installedSkillIds.filter((id) => id !== skillId)
      : [...installedSkillIds, skillId];

    const normalized = normalizeInstalledSkillIds(next);
    const previous = installedSkillIds;

    setInstalledSkillIds(normalized);
    setSavingSkillId(skillId);
    setError('');

    try {
      const response = await chatApi.updateInstalledSkills(normalized);
      const persisted = normalizeInstalledSkillIds(response.data.data?.skillIds);
      setInstalledSkillIds(persisted);
      setSkills((current) =>
        current.map((skill) => ({
          ...skill,
          installed: persisted.includes(skill.id),
        })),
      );
    } catch (error: any) {
      setInstalledSkillIds(previous);
      setError(getApiErrorMessage(error, '保存技能安装状态失败，请稍后再试。'));
    } finally {
      setSavingSkillId(null);
    }
  }

  const installedCount = useMemo(() => installedSkillIds.length, [installedSkillIds]);

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9]">
        <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载技能中心...
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#f6f7f9] px-4 py-6 md:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[32px] border border-white/80 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.06)] md:p-8">
          <header className="flex flex-col gap-6 border-b border-slate-200 pb-8 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Link
                  href="/chat"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Skills</div>
              </div>
              <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-slate-950">技能安装</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                这里安装的是站内可用的 Agent 技能。安装后，聊天工作台会直接显示对应技能，并且这次安装状态会保存在服务器端，换浏览器或换设备也能继续使用。
              </p>
            </div>

            <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
              已安装 {installedCount} 个
            </div>
          </header>

          {error ? (
            <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <section className="mt-8 grid gap-4 md:grid-cols-2">
            {skills.map((skill) => {
              const installed = installedSkillIds.includes(skill.id);
              const saving = savingSkillId === skill.id;

              return (
                <article
                  key={skill.id}
                  className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.04)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                        <Sparkles className="h-3.5 w-3.5" />
                        {skill.id}
                      </div>
                      <h2 className="mt-4 text-2xl font-semibold text-slate-950">{skill.name}</h2>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{skill.description}</p>
                    </div>

                    <button
                      onClick={() => void toggleInstall(skill.id)}
                      disabled={skill.id === 'general-agent' || saving}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                        installed
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      } ${skill.id === 'general-agent' ? 'cursor-default' : ''} ${saving ? 'opacity-70' : ''}`}
                    >
                      {saving ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          保存中
                        </span>
                      ) : installed ? (
                        <span className="inline-flex items-center gap-2">
                          <Check className="h-4 w-4" />
                          已安装
                        </span>
                      ) : (
                        '安装'
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        </div>
      </div>
    </main>
  );
}
