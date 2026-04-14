import type { AppLanguage } from './store';

export function t(language: AppLanguage, zh: string, en: string) {
  return language === 'zh' ? zh : en;
}

export function formatLocaleDate(language: AppLanguage, value?: string | null) {
  if (!value) {
    return language === 'zh' ? '-' : '-';
  }

  return new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US');
}

export function statusText(
  language: AppLanguage,
  value: 'draft' | 'pending_approval' | 'approved' | 'running' | 'completed' | 'rejected',
) {
  const map = {
    draft: ['草稿', 'Draft'],
    pending_approval: ['待审批', 'Pending Approval'],
    approved: ['已批准', 'Approved'],
    running: ['执行中', 'Running'],
    completed: ['已完成', 'Completed'],
    rejected: ['已拒绝', 'Rejected'],
  } as const;

  return t(language, map[value][0], map[value][1]);
}
