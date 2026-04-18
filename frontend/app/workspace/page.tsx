'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Briefcase,
  CheckCircle2,
  Cpu,
  Download,
  ChevronRight,
  ClipboardList,
  FileText,
  HardDrive,
  Loader2,
  Monitor,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { adminApi, chatApi, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

type TeamRecord = {
  id: string;
  name: string;
  description: string;
};

type WorkspaceTask = {
  id: string;
  title: string;
  brief: string;
  priority: 'low' | 'medium' | 'high';
  status: 'draft' | 'pending_approval' | 'approved' | 'running' | 'completed' | 'rejected';
  teamId: string | null;
  teamName: string | null;
  requiresApproval: boolean;
  approvalStatus: 'not_required' | 'pending' | 'approved' | 'rejected';
  ownerNote: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  deliverableId?: string | null;
  latestSummary?: string | null;
};

type WorkspaceApproval = {
  id: string;
  taskId: string;
  taskTitle: string;
  status: 'pending' | 'approved' | 'rejected';
  requestedAt: string;
  decidedAt?: string | null;
  reviewerNote?: string;
};

type WorkspaceDeliverable = {
  id: string;
  taskId: string;
  taskTitle: string;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string;
  content: string;
  artifacts: Array<{ id: string; label: string; type: 'summary' | 'plan' | 'member-output'; content: string }>;
  steps: Array<{
    id: string;
    label: string;
    status: 'completed' | 'warning';
    summary: string;
    memberName?: string;
    toolLabels?: string[];
  }>;
  localActions: Array<{
    id: string;
    title: string;
    instruction: string;
    workingDirectory: string;
    source: 'leader-plan' | 'member-output' | 'final-summary';
    status: 'suggested' | 'queued' | 'running' | 'completed' | 'failed';
    bridgeId?: string | null;
    jobId?: string | null;
    resultSummary?: string | null;
    completedAt?: string | null;
    stdout?: string | null;
    stderr?: string | null;
    artifacts?: string[];
  }>;
};

type WorkspaceOverview = {
  metrics: {
    totalTasks: number;
    pendingApprovals: number;
    runningTasks: number;
    completedTasks: number;
    deliverables: number;
    activeTeams: number;
  };
  recentActivity: Array<{ id: string; message: string; createdAt: string }>;
};

type WorkspaceTemplate = {
  id: string;
  name: string;
  description: string;
  suggestedTitle: string;
  suggestedBrief: string;
  suggestedPriority: 'low' | 'medium' | 'high';
  suggestedRequiresApproval: boolean;
  builtIn?: boolean;
};

type LocalBridgeRecord = {
  id: string;
  name: string;
  platform: string;
  machineLabel: string;
  workingDirectory: string;
  status: 'offline' | 'idle' | 'busy' | 'error';
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  tokenPreview: string;
};

type LocalBridgeJob = {
  id: string;
  bridgeId: string;
  userId: string;
  title: string;
  instruction: string;
  workingDirectory: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  resultSummary?: string | null;
};

const DRAFT_ID = '__workspace_draft__';

function createDraftTask(): WorkspaceTask {
  const now = new Date().toISOString();
  return {
    id: DRAFT_ID,
    title: 'New company task',
    brief: '',
    priority: 'medium',
    status: 'draft',
    teamId: null,
    teamName: null,
    requiresApproval: false,
    approvalStatus: 'not_required',
    ownerNote: '',
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    deliverableId: null,
    latestSummary: null,
  };
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function statusLabel(value: WorkspaceTask['status']) {
  return (
    {
      draft: 'Draft',
      pending_approval: 'Pending approval',
      approved: 'Approved',
      running: 'Running',
      completed: 'Completed',
      rejected: 'Rejected',
    } as Record<string, string>
  )[value];
}

export default function WorkspacePage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [approvals, setApprovals] = useState<WorkspaceApproval[]>([]);
  const [deliverables, setDeliverables] = useState<WorkspaceDeliverable[]>([]);
  const [bridges, setBridges] = useState<LocalBridgeRecord[]>([]);
  const [bridgeJobs, setBridgeJobs] = useState<LocalBridgeJob[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkspaceTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDeletingId, setTemplateDeletingId] = useState<string | null>(null);
  const [bridgeSaving, setBridgeSaving] = useState(false);
  const [bridgeJobSaving, setBridgeJobSaving] = useState(false);
  const [queueingDeliverableId, setQueueingDeliverableId] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<WorkspaceTemplate>({
    id: '',
    name: '',
    description: '',
    suggestedTitle: '',
    suggestedBrief: '',
    suggestedPriority: 'medium',
    suggestedRequiresApproval: false,
    builtIn: false,
  });
  const [bridgeDraft, setBridgeDraft] = useState({
    name: 'My Local Bridge',
    platform: 'windows',
    machineLabel: 'Office PC',
    workingDirectory: 'E:\\api-platform缃戠珯骞冲彴',
  });
  const [bridgeJobDraft, setBridgeJobDraft] = useState({
    bridgeId: '',
    title: 'Generate local execution report',
    instruction:
      'Open the assigned working directory, summarize the key project files, and write a markdown report named local-execution-report.md.',
    workingDirectory: 'E:\\api-platform缃戠珯骞冲彴',
  });

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadWorkspace();
  }, [isAuthenticated]);

  const selectedDeliverable = useMemo(
    () => deliverables.find((item) => item.taskId === selectedTaskId) || null,
    [deliverables, selectedTaskId],
  );

  async function loadWorkspace() {
    setLoading(true);
    setError('');

    try {
      const [overviewRes, templatesRes, tasksRes, teamsRes, approvalsRes, deliverablesRes, bridgesRes, bridgeJobsRes] = await Promise.all([
        chatApi.getWorkspaceOverview(),
        chatApi.getWorkspaceTemplates(),
        chatApi.getWorkspaceTasks(),
        chatApi.getTeams(),
        chatApi.getWorkspaceApprovals(),
        chatApi.getWorkspaceDeliverables(),
        chatApi.getLocalBridges(),
        chatApi.getLocalBridgeJobs(),
      ]);

      const nextOverview = overviewRes.data.data as WorkspaceOverview;
      const nextTemplates = templatesRes.data.data as WorkspaceTemplate[];
      const nextTasks = tasksRes.data.data as WorkspaceTask[];
      const nextTeams = teamsRes.data.data as TeamRecord[];
      const nextApprovals = approvalsRes.data.data as WorkspaceApproval[];
      const nextDeliverables = deliverablesRes.data.data as WorkspaceDeliverable[];
      const nextBridges = bridgesRes.data.data as LocalBridgeRecord[];
      const nextBridgeJobs = bridgeJobsRes.data.data as LocalBridgeJob[];

      setOverview(nextOverview);
      setTemplates(nextTemplates);
      setTasks(nextTasks);
      setTeams(nextTeams);
      setApprovals(nextApprovals);
      setDeliverables(nextDeliverables);
      setBridges(nextBridges);
      setBridgeJobs(nextBridgeJobs);

      setBridgeJobDraft((current) => ({
        ...current,
        bridgeId: current.bridgeId || nextBridges[0]?.id || '',
      }));

      const initialTask = nextTasks.find((item) => item.id === selectedTaskId) || nextTasks[0] || createDraftTask();
      setSelectedTaskId(initialTask.id);
      setDraft(initialTask);
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to load the workspace.'));
    } finally {
      setLoading(false);
    }
  }

  function applyTemplate(template: WorkspaceTemplate) {
    const next = draft && draft.id !== DRAFT_ID ? draft : createDraftTask();
    setSelectedTaskId(next.id);
    setDraft({
      ...next,
      title: template.suggestedTitle,
      brief: template.suggestedBrief,
      priority: template.suggestedPriority,
      requiresApproval: template.suggestedRequiresApproval,
      approvalStatus: template.suggestedRequiresApproval ? 'pending' : 'not_required',
    });
    setSuccess(`Template "${template.name}" applied.`);
    setError('');
  }

  function editTemplate(template: WorkspaceTemplate) {
    if (template.builtIn) return;
    setTemplateDraft(template);
    setSuccess(`Editing template "${template.name}".`);
    setError('');
  }

  function resetTemplateDraft() {
    setTemplateDraft({
      id: '',
      name: '',
      description: '',
      suggestedTitle: '',
      suggestedBrief: '',
      suggestedPriority: 'medium',
      suggestedRequiresApproval: false,
      builtIn: false,
    });
  }

  function selectTask(task: WorkspaceTask) {
    setSelectedTaskId(task.id);
    setDraft(task);
    setSuccess('');
    setError('');
  }

  function createTask() {
    const next = createDraftTask();
    setSelectedTaskId(next.id);
    setDraft(next);
    setSuccess('');
    setError('');
  }

  function updateDraft(patch: Partial<WorkspaceTask>) {
    if (!draft) return;
    const nextTeam = patch.teamId ? teams.find((item) => item.id === patch.teamId) || null : undefined;
    setDraft({
      ...draft,
      ...patch,
      teamName: typeof patch.teamId === 'undefined' ? draft.teamName : nextTeam?.name || null,
    });
    setSuccess('');
  }

  async function saveTask() {
    if (!draft) return;
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        title: draft.title,
        brief: draft.brief,
        priority: draft.priority,
        teamId: draft.teamId,
        requiresApproval: draft.requiresApproval,
        ownerNote: draft.ownerNote,
      };

      const response =
        draft.id === DRAFT_ID
          ? await chatApi.createWorkspaceTask(payload)
          : await chatApi.updateWorkspaceTask(draft.id, payload);

      const saved = (response.data.data.task || response.data.data) as WorkspaceTask;
      setTasks((current) => {
        if (draft.id === DRAFT_ID) {
          return [saved, ...current];
        }
        return current.map((item) => (item.id === saved.id ? saved : item));
      });
      setSelectedTaskId(saved.id);
      setDraft(saved);
      setSuccess(saved.requiresApproval ? 'Task saved and waiting for approval.' : 'Task saved.');
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save task.'));
    } finally {
      setSaving(false);
    }
  }

  async function runTask() {
    if (!draft || draft.id === DRAFT_ID) return;
    setRunning(true);
    setError('');
    setSuccess('');

    try {
      await chatApi.runWorkspaceTask(draft.id);
      setSuccess('Team execution finished. Deliverable generated.');
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to run task.'));
    } finally {
      setRunning(false);
    }
  }

  async function decideApproval(approvalId: string, action: 'approve' | 'reject') {
    setError('');
    setSuccess('');
    try {
      if (action === 'approve') {
        await chatApi.approveWorkspaceTask(approvalId, approvalNotes[approvalId] || '');
        setSuccess('Approval granted.');
      } else {
        await chatApi.rejectWorkspaceTask(approvalId, approvalNotes[approvalId] || '');
        setSuccess('Approval rejected.');
      }
      setApprovalNotes((current) => ({ ...current, [approvalId]: '' }));
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to update approval.'));
    }
  }

  async function exportDeliverable(deliverableId: string) {
    setExportingId(deliverableId);
    setError('');
    try {
      const response = await chatApi.exportWorkspaceDeliverable(deliverableId);
      const payload = response.data.data as { filename: string; content: string };
      const blob = new Blob([payload.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setSuccess('Deliverable exported.');
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to export deliverable.'));
    } finally {
      setExportingId(null);
    }
  }

  async function saveTemplate() {
    if (!templateDraft.name.trim()) return;
    setTemplateSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload = {
        name: templateDraft.name,
        description: templateDraft.description,
        suggestedTitle: templateDraft.suggestedTitle,
        suggestedBrief: templateDraft.suggestedBrief,
        suggestedPriority: templateDraft.suggestedPriority,
        suggestedRequiresApproval: templateDraft.suggestedRequiresApproval,
      };

      if (templateDraft.id) {
        await adminApi.updateWorkspaceTemplate(templateDraft.id, payload);
        setSuccess('Template updated.');
      } else {
        await adminApi.createWorkspaceTemplate(payload);
        setSuccess('Template created.');
      }

      resetTemplateDraft();
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to save template.'));
    } finally {
      setTemplateSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    setTemplateDeletingId(id);
    setError('');
    setSuccess('');

    try {
      await adminApi.deleteWorkspaceTemplate(id);
      if (templateDraft.id === id) {
        resetTemplateDraft();
      }
      setSuccess('Template deleted.');
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to delete template.'));
    } finally {
      setTemplateDeletingId(null);
    }
  }

  async function createBridge() {
    setBridgeSaving(true);
    setError('');
    setSuccess('');

    try {
      const response = await chatApi.createLocalBridge(bridgeDraft);
      const payload = response.data.data as { bridge: LocalBridgeRecord; token: string };
      setSuccess(`Bridge created. Save this token now: ${payload.token}`);
      setBridgeDraft((current) => ({ ...current, name: 'My Local Bridge' }));
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to create bridge.'));
    } finally {
      setBridgeSaving(false);
    }
  }

  async function enqueueBridgeJob() {
    if (!bridgeJobDraft.bridgeId) return;
    setBridgeJobSaving(true);
    setError('');
    setSuccess('');

    try {
      await chatApi.enqueueLocalBridgeJob(bridgeJobDraft.bridgeId, {
        title: bridgeJobDraft.title,
        instruction: bridgeJobDraft.instruction,
        workingDirectory: bridgeJobDraft.workingDirectory,
      });
      setSuccess('Local bridge job queued.');
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to queue local bridge job.'));
    } finally {
      setBridgeJobSaving(false);
    }
  }

  async function queueDeliverableLocalActions(deliverableId: string) {
    if (!bridgeJobDraft.bridgeId) return;
    setQueueingDeliverableId(deliverableId);
    setError('');
    setSuccess('');

    try {
      await chatApi.queueWorkspaceDeliverableLocalActions(deliverableId, bridgeJobDraft.bridgeId);
      setSuccess('Deliverable local actions queued to bridge.');
      await loadWorkspace();
    } catch (err: any) {
      setError(getApiErrorMessage(err, 'Failed to queue deliverable actions.'));
    } finally {
      setQueueingDeliverableId(null);
    }
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f0ea]">
        <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading workspace...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(238,190,125,0.22),_transparent_34%),linear-gradient(180deg,#f8f5ef_0%,#f2efe7_100%)] text-slate-900">
      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium uppercase tracking-[0.25em] text-amber-700">
              <Briefcase className="h-3.5 w-3.5" />
              Workspace OS
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Company Workspace</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              One place for tasks, team execution, approvals, and final deliverables.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm"
            >
              Back to chat
            </Link>
            <Link
              href="/teams"
              className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white shadow-sm"
            >
              Manage teams
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        <div className="mb-6 rounded-[28px] border border-emerald-200 bg-gradient-to-r from-emerald-50 to-cyan-50 p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-4">
              <div className="inline-flex rounded-2xl border border-emerald-200 bg-white p-3">
                <Monitor className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <div className="text-lg font-semibold text-slate-900">VGO CODE 桌面应用</div>
                <div className="mt-1 text-sm text-slate-600">
                  网站内模型自动配置 · 本地 Ollama 深度集成 · 零配置体验
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/teams"
                className="inline-flex items-center gap-2 rounded-full border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-700"
              >
                查看详情
              </Link>
              <a
                href="/downloads/vgo-code/VGO-CODE-Setup-1.0.3.exe"
                download
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white"
              >
                <Download className="h-4 w-4" />
                下载安装包
              </a>
            </div>
          </div>
        </div>

        {error ? <div className="mb-4 rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {success ? <div className="mb-4 rounded-3xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {[
            { label: 'Tasks', value: overview?.metrics.totalTasks || 0, icon: ClipboardList },
            { label: 'Pending approvals', value: overview?.metrics.pendingApprovals || 0, icon: ShieldCheck },
            { label: 'Running', value: overview?.metrics.runningTasks || 0, icon: Bot },
            { label: 'Completed', value: overview?.metrics.completedTasks || 0, icon: CheckCircle2 },
            { label: 'Deliverables', value: overview?.metrics.deliverables || 0, icon: FileText },
            { label: 'Active teams', value: overview?.metrics.activeTeams || 0, icon: Briefcase },
          ].map((item) => (
            <div key={item.label} className="rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-slate-500">{item.label}</span>
                <item.icon className="h-4 w-4 text-slate-400" />
              </div>
              <div className="mt-4 text-3xl font-semibold">{item.value}</div>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Tasks</div>
                <div className="text-xs text-slate-500">Create, assign, and run.</div>
              </div>
              <button
                onClick={createTask}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
            </div>

            <div className="space-y-3">
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => selectTask(task)}
                  className={`w-full rounded-[24px] border px-4 py-3 text-left transition ${
                    selectedTaskId === task.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300'
                  }`}
                >
                  <div className="text-sm font-semibold">{task.title}</div>
                  <div className={`mt-1 text-xs ${selectedTaskId === task.id ? 'text-slate-300' : 'text-slate-500'}`}>
                    {statusLabel(task.status)} 鈥?{task.teamName || 'No team'}
                  </div>
                </button>
              ))}
              {!tasks.length ? <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">No tasks yet. Create your first one.</div> : null}
            </div>
          </aside>

          <section className="rounded-[30px] border border-white/80 bg-white/90 p-5 shadow-sm shadow-slate-200/50">
            {draft ? (
              <>
                <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className="rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white"
                    >
                      <button onClick={() => applyTemplate(template)} className="w-full text-left">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">{template.name}</div>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-500">
                            {template.builtIn ? 'Built-in' : 'Custom'}
                          </span>
                        </div>
                      </button>
                      <div className="mt-2 text-sm leading-6 text-slate-600">{template.description}</div>
                      {user?.isAdmin && !template.builtIn ? (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => editTemplate(template)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => void deleteTemplate(template.id)}
                            disabled={templateDeletingId === template.id}
                            className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 disabled:opacity-50"
                          >
                            <Trash2 className="mr-1 inline h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Task Editor</div>
                    <h2 className="mt-2 text-2xl font-semibold">{draft.id === DRAFT_ID ? 'New task' : draft.title}</h2>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => void saveTask()}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save
                    </button>
                    <button
                      onClick={() => void runTask()}
                      disabled={running || draft.id === DRAFT_ID}
                      className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      Run team
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-slate-700">Task title</div>
                    <input
                      value={draft.title}
                      onChange={(e) => updateDraft({ title: e.target.value })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-slate-700">Assigned team</div>
                    <select
                      value={draft.teamId || ''}
                      onChange={(e) => updateDraft({ teamId: e.target.value || null })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
                    >
                      <option value="">Select a team</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-sm font-medium text-slate-700">Priority</div>
                    <select
                      value={draft.priority}
                      onChange={(e) => updateDraft({ priority: e.target.value as WorkspaceTask['priority'] })}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                  <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-sm font-medium text-slate-700">Require approval</div>
                      <div className="text-xs text-slate-500">Gate execution with a workspace approval step.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.requiresApproval}
                      onChange={(e) => updateDraft({ requiresApproval: e.target.checked })}
                      className="h-4 w-4"
                    />
                  </label>
                </div>

                <label className="mt-4 block">
                  <div className="mb-2 text-sm font-medium text-slate-700">Task brief</div>
                  <textarea
                    value={draft.brief}
                    onChange={(e) => updateDraft({ brief: e.target.value })}
                    rows={7}
                    className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 outline-none"
                    placeholder="Describe the outcome you want. The assigned team will split work and produce the final deliverable."
                  />
                </label>

                <label className="mt-4 block">
                  <div className="mb-2 text-sm font-medium text-slate-700">Owner note</div>
                  <textarea
                    value={draft.ownerNote}
                    onChange={(e) => updateDraft({ ownerNote: e.target.value })}
                    rows={3}
                    className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 outline-none"
                    placeholder="Optional constraints, quality bar, or execution preferences."
                  />
                </label>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</div>
                    <div className="mt-2 text-sm font-medium">{statusLabel(draft.status)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Approval</div>
                    <div className="mt-2 text-sm font-medium">{draft.approvalStatus}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Updated</div>
                    <div className="mt-2 text-sm font-medium">{formatDate(draft.updatedAt)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Last run</div>
                    <div className="mt-2 text-sm font-medium">{formatDate(draft.lastRunAt)}</div>
                  </div>
                </div>

                {selectedDeliverable ? (
                  <div className="mt-6 rounded-[28px] border border-emerald-200 bg-emerald-50/80 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                        <FileText className="h-4 w-4" />
                        Latest deliverable
                      </div>
                      <button
                        onClick={() => void exportDeliverable(selectedDeliverable.id)}
                        disabled={exportingId === selectedDeliverable.id}
                        className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-medium text-emerald-700 disabled:opacity-50"
                      >
                        {exportingId === selectedDeliverable.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Export Markdown
                      </button>
                    </div>
                    {selectedDeliverable.localActions?.length ? (
                      <div className="mt-4 rounded-[22px] border border-emerald-200/70 bg-white/80 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Suggested local actions</div>
                            <div className="mt-1 text-xs text-slate-500">
                              Generated automatically from the digital team deliverable.
                            </div>
                          </div>
                          <button
                            onClick={() => void queueDeliverableLocalActions(selectedDeliverable.id)}
                            disabled={!bridgeJobDraft.bridgeId || queueingDeliverableId === selectedDeliverable.id}
                            className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 py-2 text-xs font-medium text-emerald-700 disabled:opacity-50"
                          >
                            {queueingDeliverableId === selectedDeliverable.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Play className="h-3.5 w-3.5" />
                            )}
                            Queue all to bridge
                          </button>
                        </div>
                        <div className="mt-4 grid gap-3">
                          {selectedDeliverable.localActions.map((action) => (
                            <div key={action.id} className="rounded-2xl border border-emerald-200/60 bg-white px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-semibold text-slate-800">{action.title}</span>
                                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-medium text-emerald-700">
                                  {action.status}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                                  {action.source}
                                </span>
                              </div>
                              <div className="mt-2 text-xs text-slate-500">Working directory: {action.workingDirectory}</div>
                              <div className="mt-3 text-sm leading-6 text-slate-700">{action.instruction}</div>
                              {action.resultSummary ? (
                                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                                  {action.resultSummary}
                                </div>
                              ) : null}
                              {action.jobId ? (
                                <div className="mt-3 text-xs text-slate-500">
                                  Job ID: {action.jobId}
                                  {action.completedAt ? ` · Completed: ${formatDate(action.completedAt)}` : ''}
                                </div>
                              ) : null}
                              {action.artifacts?.length ? (
                                <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2">
                                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                                    Artifacts
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    {action.artifacts.map((artifact) =>
                                      artifact.startsWith('http://') || artifact.startsWith('https://') ? (
                                        <a
                                          key={artifact}
                                          href={artifact}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="inline-flex items-center rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-sky-700 transition hover:border-sky-300 hover:text-sky-800"
                                        >
                                          {artifact}
                                        </a>
                                      ) : (
                                        <span
                                          key={artifact}
                                          className="inline-flex items-center rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-medium text-sky-700"
                                        >
                                          {artifact}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                </div>
                              ) : null}
                              {action.stdout ? (
                                <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                  <summary className="cursor-pointer font-medium text-slate-700">View stdout</summary>
                                  <pre className="mt-2 whitespace-pre-wrap break-words leading-6">{action.stdout}</pre>
                                </details>
                              ) : null}
                              {action.stderr ? (
                                <details className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                                  <summary className="cursor-pointer font-medium">View stderr</summary>
                                  <pre className="mt-2 whitespace-pre-wrap break-words leading-6">{action.stderr}</pre>
                                </details>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-3 text-sm leading-7 text-slate-700">{selectedDeliverable.content}</div>
                    {selectedDeliverable.steps?.length ? (
                      <div className="mt-5 grid gap-3">
                        {selectedDeliverable.steps.map((step) => (
                          <div key={step.id} className="rounded-2xl border border-emerald-200/60 bg-white/80 px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-800">{step.label}</span>
                              <span
                                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                                  step.status === 'warning'
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {step.status}
                              </span>
                              {step.memberName ? <span className="text-xs text-slate-500">{step.memberName}</span> : null}
                            </div>
                            <div className="mt-2 text-sm leading-6 text-slate-600">{step.summary}</div>
                            {step.toolLabels?.length ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                {step.toolLabels.map((label) => (
                                  <span
                                    key={`${step.id}-${label}`}
                                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {selectedDeliverable.artifacts?.length ? (
                      <div className="mt-5 grid gap-3 md:grid-cols-2">
                        {selectedDeliverable.artifacts.map((artifact) => (
                          <div key={artifact.id} className="rounded-2xl border border-emerald-200/60 bg-white/80 px-4 py-3">
                            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{artifact.type}</div>
                            <div className="mt-2 text-sm font-semibold text-slate-800">{artifact.label}</div>
                            <div className="mt-2 text-sm leading-6 text-slate-600">{artifact.content}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </section>

          <aside className="space-y-6">
            <div className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <HardDrive className="h-4 w-4" />
                Local Bridge
              </div>
              <div className="space-y-3">
                <input
                  value={bridgeDraft.name}
                  onChange={(e) => setBridgeDraft((current) => ({ ...current, name: e.target.value }))}
                  placeholder="Bridge name"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    value={bridgeDraft.machineLabel}
                    onChange={(e) => setBridgeDraft((current) => ({ ...current, machineLabel: e.target.value }))}
                    placeholder="Machine label"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                  />
                  <input
                    value={bridgeDraft.platform}
                    onChange={(e) => setBridgeDraft((current) => ({ ...current, platform: e.target.value }))}
                    placeholder="Platform"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                  />
                </div>
                <input
                  value={bridgeDraft.workingDirectory}
                  onChange={(e) => setBridgeDraft((current) => ({ ...current, workingDirectory: e.target.value }))}
                  placeholder="Working directory"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                />
                <button
                  onClick={() => void createBridge()}
                  disabled={bridgeSaving}
                  className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {bridgeSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cpu className="h-3.5 w-3.5" />}
                  Create bridge
                </button>
                <div className="space-y-2">
                  {bridges.length ? (
                    bridges.map((bridge) => (
                      <div key={bridge.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{bridge.name}</div>
                            <div className="mt-1 text-xs text-slate-500">
                              {bridge.machineLabel} 路 {bridge.platform} 路 {bridge.status}
                            </div>
                          </div>
                          <button
                            onClick={() => setBridgeJobDraft((current) => ({ ...current, bridgeId: bridge.id }))}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700"
                          >
                            Use
                          </button>
                        </div>
                        <div className="mt-3 text-xs leading-6 text-slate-500">
                          Token preview: {bridge.tokenPreview}
                          <br />
                          Last seen: {formatDate(bridge.lastSeenAt)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                      No local bridge yet.
                    </div>
                  )}
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-900">Queue local execution job</div>
                  <div className="mt-3 space-y-3">
                    <select
                      value={bridgeJobDraft.bridgeId}
                      onChange={(e) => setBridgeJobDraft((current) => ({ ...current, bridgeId: e.target.value }))}
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    >
                      <option value="">Select bridge</option>
                      {bridges.map((bridge) => (
                        <option key={bridge.id} value={bridge.id}>
                          {bridge.name}
                        </option>
                      ))}
                    </select>
                    <input
                      value={bridgeJobDraft.title}
                      onChange={(e) => setBridgeJobDraft((current) => ({ ...current, title: e.target.value }))}
                      placeholder="Job title"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <input
                      value={bridgeJobDraft.workingDirectory}
                      onChange={(e) =>
                        setBridgeJobDraft((current) => ({ ...current, workingDirectory: e.target.value }))
                      }
                      placeholder="Working directory"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <textarea
                      value={bridgeJobDraft.instruction}
                      onChange={(e) => setBridgeJobDraft((current) => ({ ...current, instruction: e.target.value }))}
                      rows={4}
                      placeholder="Instruction"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <button
                      onClick={() => void enqueueBridgeJob()}
                      disabled={bridgeJobSaving || !bridgeJobDraft.bridgeId}
                      className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {bridgeJobSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Queue job
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <ShieldCheck className="h-4 w-4" />
                Approvals
              </div>
              <div className="space-y-3">
                      {approvals.length ? (
                  approvals.map((approval) => (
                    <div key={approval.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold">{approval.taskTitle}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {approval.status} 鈥?{formatDate(approval.requestedAt)}
                      </div>
                      <textarea
                        value={approvalNotes[approval.id] || ''}
                        onChange={(e) =>
                          setApprovalNotes((current) => ({ ...current, [approval.id]: e.target.value }))
                        }
                        rows={2}
                        placeholder="Optional approval note"
                        className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      />
                      {approval.status === 'pending' ? (
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => void decideApproval(approval.id, 'approve')}
                            className="rounded-full bg-[#111827] px-3 py-2 text-xs font-medium text-white"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => void decideApproval(approval.id, 'reject')}
                            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700"
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                    No approvals waiting.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Cpu className="h-4 w-4" />
                Local job queue
              </div>
              <div className="space-y-3">
                {bridgeJobs.length ? (
                  bridgeJobs.slice(0, 8).map((job) => (
                    <div key={job.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold">{job.title}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {job.status} 路 {formatDate(job.updatedAt)}
                      </div>
                      <div className="mt-3 text-sm leading-6 text-slate-600">{job.resultSummary || job.instruction}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                    No local jobs yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <FileText className="h-4 w-4" />
                Deliverables
              </div>
              <div className="space-y-3">
                {deliverables.length ? (
                  deliverables.map((deliverable) => (
                    <button
                      key={deliverable.id}
                      onClick={() => {
                        const task = tasks.find((item) => item.id === deliverable.taskId);
                        if (task) {
                          selectTask(task);
                        }
                      }}
                      className="block w-full rounded-3xl border border-slate-200 bg-slate-50 p-4 text-left"
                    >
                      <div className="text-sm font-semibold">{deliverable.taskTitle}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {deliverable.teamName || 'Unassigned team'} 鈥?{formatDate(deliverable.createdAt)}
                      </div>
                      <div className="mt-3 text-sm leading-6 text-slate-600">{deliverable.summary}</div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                    No deliverables yet.
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Bot className="h-4 w-4" />
                Recent activity
              </div>
              <div className="space-y-3">
                {overview?.recentActivity?.length ? (
                  overview.recentActivity.map((item) => (
                    <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm text-slate-700">{item.message}</div>
                      <div className="mt-2 text-xs text-slate-500">{formatDate(item.createdAt)}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">
                    No recent activity yet.
                  </div>
                )}
              </div>
            </div>

            {user?.isAdmin ? (
              <div className="rounded-[30px] border border-white/80 bg-white/90 p-4 shadow-sm shadow-slate-200/50">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Briefcase className="h-4 w-4" />
                  Template Studio
                </div>
                <div className="space-y-3">
                  <input
                    value={templateDraft.name}
                    onChange={(e) => setTemplateDraft((current) => ({ ...current, name: e.target.value }))}
                    placeholder="Template name"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                  />
                  <textarea
                    value={templateDraft.description}
                    onChange={(e) => setTemplateDraft((current) => ({ ...current, description: e.target.value }))}
                    rows={2}
                    placeholder="Template description"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                  />
                  <input
                    value={templateDraft.suggestedTitle}
                    onChange={(e) => setTemplateDraft((current) => ({ ...current, suggestedTitle: e.target.value }))}
                    placeholder="Suggested title"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                  />
                  <textarea
                    value={templateDraft.suggestedBrief}
                    onChange={(e) => setTemplateDraft((current) => ({ ...current, suggestedBrief: e.target.value }))}
                    rows={4}
                    placeholder="Suggested brief"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <select
                      value={templateDraft.suggestedPriority}
                      onChange={(e) =>
                        setTemplateDraft((current) => ({
                          ...current,
                          suggestedPriority: e.target.value as WorkspaceTemplate['suggestedPriority'],
                        }))
                      }
                      className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                    <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      Approval
                      <input
                        type="checkbox"
                        checked={templateDraft.suggestedRequiresApproval}
                        onChange={(e) =>
                          setTemplateDraft((current) => ({
                            ...current,
                            suggestedRequiresApproval: e.target.checked,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void saveTemplate()}
                      disabled={templateSaving}
                      className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {templateSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {templateDraft.id ? 'Update template' : 'Create template'}
                    </button>
                    <button
                      onClick={resetTemplateDraft}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}

