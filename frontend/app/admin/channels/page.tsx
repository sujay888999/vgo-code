'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Cpu, Plus, RefreshCw, Save, TestTube2, Trash2, X } from 'lucide-react';
import { adminApi, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/store';

interface ChannelModelConfig {
  id?: string;
  modelName: string;
  protocol?: string;
  inputPrice: number;
  outputPrice: number;
  cacheWritePrice?: number;
  cacheReadPrice?: number;
  isActive: boolean;
}

interface ChannelRecord {
  id: string;
  name: string;
  channelType: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  modelConfigs?: ChannelModelConfig[];
  priority: number;
  priceRate: number;
  balance: number;
  isActive: boolean;
  isPublicBeta?: boolean;
  betaFreeUntil?: string | null;
  betaLabel?: string | null;
}

interface ModelPreset {
  id: string;
  label: string;
  summary: string;
  family: string;
  tags: string[];
}

interface ModelTestResult {
  success: boolean;
  modelName: string;
  protocol: string;
  status?: number | null;
  message?: string;
  error?: any;
  response?: any;
}

interface ModelRow {
  modelName: string;
  protocol: string;
  inputPrice: string;
  outputPrice: string;
  cacheWritePrice: string;
  cacheReadPrice: string;
  isActive: boolean;
}

interface PricingEntry {
  inputPrice: number;
  outputPrice: number;
  cacheWritePrice: number;
  cacheReadPrice: number;
}

interface PricingReferenceRow {
  modelName: string;
  official: PricingEntry;
  retail: PricingEntry;
}

interface PricingReferencePayload {
  markupMultiplier: number;
  rows: PricingReferenceRow[];
}

type BrandMeta = {
  label: string;
  tone: string;
};

const BRAND_RULES: Array<{ match: RegExp; meta: BrandMeta }> = [
  { match: /(minimax|abab|minimax-m)/i, meta: { label: 'MiniMax', tone: 'bg-rose-50 text-rose-700 border-rose-200' } },
  { match: /(anthropic|claude)/i, meta: { label: 'Anthropic', tone: 'bg-amber-50 text-amber-700 border-amber-200' } },
  { match: /(google|gemini)/i, meta: { label: 'Google Gemini', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' } },
  { match: /(moonshot|kimi)/i, meta: { label: 'Moonshot', tone: 'bg-violet-50 text-violet-700 border-violet-200' } },
  { match: /(zhipu|glm)/i, meta: { label: 'Zhipu', tone: 'bg-cyan-50 text-cyan-700 border-cyan-200' } },
  { match: /(nvidia|nemotron)/i, meta: { label: 'NVIDIA', tone: 'bg-lime-50 text-lime-700 border-lime-200' } },
  { match: /(qwen|tongyi|alibaba)/i, meta: { label: 'Qwen', tone: 'bg-orange-50 text-orange-700 border-orange-200' } },
  { match: /(openai|gpt|codex|o1|o3|o4)/i, meta: { label: 'OpenAI', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' } },
];

function inferBrand(value: string) {
  const matched = BRAND_RULES.find((rule) => rule.match.test(value));
  return matched?.meta || { label: 'Other', tone: 'bg-slate-100 text-slate-700 border-slate-200' };
}

const emptyRow = (): ModelRow => ({
  modelName: '',
  protocol: 'auto',
  inputPrice: '',
  outputPrice: '',
  cacheWritePrice: '',
  cacheReadPrice: '',
  isActive: true,
});

function rowsFromChannel(channel?: ChannelRecord | null): ModelRow[] {
  if (!channel) return [emptyRow()];

  if (channel.modelConfigs?.length) {
    return channel.modelConfigs.map((item) => ({
      modelName: item.modelName,
      protocol: item.protocol || 'auto',
      inputPrice: String(item.inputPrice ?? 0),
      outputPrice: String(item.outputPrice ?? 0),
      cacheWritePrice: String(item.cacheWritePrice ?? 0),
      cacheReadPrice: String(item.cacheReadPrice ?? 0),
      isActive: item.isActive,
    }));
  }

  if (channel.models?.length) {
    return channel.models.map((model) => ({ ...emptyRow(), modelName: model }));
  }

  return [emptyRow()];
}

function buildModelPayload(rows: ModelRow[]) {
  const cleaned = rows
    .map((row) => ({
      modelName: row.modelName.trim(),
      protocol: row.protocol || 'auto',
      inputPrice: Number(row.inputPrice || 0),
      outputPrice: Number(row.outputPrice || 0),
      cacheWritePrice: Number(row.cacheWritePrice || 0),
      cacheReadPrice: Number(row.cacheReadPrice || 0),
      isActive: row.isActive,
    }))
    .filter((row) => row.modelName);

  return {
    models: cleaned.map((row) => row.modelName),
    modelConfigs: cleaned,
  };
}

function protocolFromPresetId(id: string) {
  if (id.startsWith('claude-')) return 'anthropic';
  if (id.startsWith('gemini-')) return 'gemini';
  if (id.startsWith('gpt-')) return 'openai-responses';
  return 'auto';
}

export default function ChannelsPage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth } = useAuthStore();
  const router = useRouter();
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [presets, setPresets] = useState<ModelPreset[]>([]);
  const [pricingReference, setPricingReference] = useState<PricingReferencePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingModel, setTestingModel] = useState(false);
  const [syncingPricing, setSyncingPricing] = useState(false);
  const [error, setError] = useState('');
  const [modelTestError, setModelTestError] = useState('');
  const [modelTestResult, setModelTestResult] = useState<ModelTestResult | null>(null);
  const [editing, setEditing] = useState<ChannelRecord | null>(null);
  const [form, setForm] = useState({
    name: '',
    channelType: 'openai',
    baseUrl: '',
    apiKey: '',
    priority: '1',
    priceRate: '1',
    balance: '0',
    isPublicBeta: false,
    betaFreeUntil: '2026-04-15',
    betaLabel: '内测免费',
  });
  const [modelRows, setModelRows] = useState<ModelRow[]>([emptyRow()]);

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
      void loadChannels();
    }
  }, [isAuthenticated, user]);

  const activeCount = useMemo(() => channels.filter((channel) => channel.isActive).length, [channels]);

  const recommendedPresets = useMemo(() => {
    const baseUrl = form.baseUrl.toLowerCase();
    if (form.channelType === 'anthropic' || baseUrl.includes('/messages')) {
      return presets.filter((preset) => preset.id.startsWith('claude-'));
    }
    if (baseUrl.includes('/responses')) {
      return presets.filter((preset) => preset.id.startsWith('gpt-'));
    }
    if (baseUrl.includes('generativelanguage.googleapis.com') || baseUrl.includes('/v1/models/')) {
      return presets.filter((preset) => preset.id.startsWith('gemini-'));
    }
    if (baseUrl.includes('/chat/completions')) {
      return presets.filter(
        (preset) => !preset.id.startsWith('gpt-') && !preset.id.startsWith('claude-') && !preset.id.startsWith('gemini-'),
      );
    }
    return presets;
  }, [form.baseUrl, form.channelType, presets]);

  const pricingReferenceMap = useMemo(() => {
    const map = new Map<string, PricingReferenceRow>();
    for (const row of pricingReference?.rows || []) {
      map.set(row.modelName, row);
    }
    return map;
  }, [pricingReference]);

  async function loadChannels() {
    try {
      const [channelsResponse, presetsResponse, pricingResponse] = await Promise.all([
        adminApi.getChannels(),
        adminApi.getChannelModelPresets(),
        adminApi.getOpencodeZenPricing(),
      ]);
      setChannels(channelsResponse.data || []);
      setPresets(presetsResponse.data?.data || []);
      setPricingReference(pricingResponse.data?.data || null);
    } catch (loadError) {
      console.error('Failed to load channels', loadError);
      setError(getApiErrorMessage(loadError, '渠道列表加载失败，请稍后重试。'));
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setEditing(null);
    setError('');
    setModelTestError('');
    setModelTestResult(null);
    setForm({
      name: '',
      channelType: 'openai',
      baseUrl: '',
      apiKey: '',
      priority: '1',
      priceRate: '1',
      balance: '0',
      isPublicBeta: false,
      betaFreeUntil: '2026-04-15',
      betaLabel: '内测免费',
    });
    setModelRows([emptyRow()]);
  }

  function startEdit(channel: ChannelRecord) {
    setEditing(channel);
    setError('');
    setModelTestError('');
    setModelTestResult(null);
    setForm({
      name: channel.name,
      channelType: channel.channelType,
      baseUrl: channel.baseUrl,
      apiKey: channel.apiKey || '',
      priority: String(channel.priority ?? 1),
      priceRate: String(channel.priceRate ?? 1),
      balance: String(channel.balance ?? 0),
      isPublicBeta: Boolean(channel.isPublicBeta),
      betaFreeUntil: channel.betaFreeUntil || '2026-04-15',
      betaLabel: channel.betaLabel || '内测免费',
    });
    setModelRows(rowsFromChannel(channel));
  }

  function updateRow(index: number, patch: Partial<ModelRow>) {
    setModelRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setModelRows((current) => [...current, emptyRow()]);
  }

  function removeRow(index: number) {
    setModelRows((current) => {
      if (current.length === 1) return [emptyRow()];
      return current.filter((_, rowIndex) => rowIndex !== index);
    });
  }

  function applyPreset(preset: ModelPreset) {
    setModelRows((current) => {
      if (current.some((row) => row.modelName.trim() === preset.id)) return current;
      return [...current.filter((row) => row.modelName.trim()), { ...emptyRow(), modelName: preset.id, protocol: protocolFromPresetId(preset.id) }];
    });
  }

  function applyRecommendedPresets() {
    setModelRows((current) => {
      const existingIds = new Set(current.map((row) => row.modelName.trim()).filter(Boolean));
      const merged = [...current.filter((row) => row.modelName.trim())];
      for (const preset of recommendedPresets) {
        if (existingIds.has(preset.id)) continue;
        merged.push({ ...emptyRow(), modelName: preset.id, protocol: protocolFromPresetId(preset.id) });
      }
      return merged.length ? merged : [emptyRow()];
    });
  }

  async function handleTestModel(row: ModelRow) {
    if (!editing?.id) {
      setModelTestError('请先保存渠道，再进行单模型测试。');
      return;
    }
    if (!row.modelName.trim()) {
      setModelTestError('请先填写模型 ID，再进行测试。');
      return;
    }

    setTestingModel(true);
    setModelTestError('');
    setModelTestResult(null);
    try {
      const response = await adminApi.testChannelModel(editing.id, {
        modelName: row.modelName.trim(),
        protocol: row.protocol || 'auto',
        message: 'Hello from VGO AI admin tester.',
      });
      setModelTestResult(response.data);
    } catch (testError) {
      console.error('Failed to test model', testError);
      setModelTestError(getApiErrorMessage(testError, '模型测试失败，请稍后重试。'));
    } finally {
      setTestingModel(false);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    setError('');

    const modelPayload = buildModelPayload(modelRows);
    const payload = {
      name: form.name.trim(),
      channelType: form.channelType,
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      priority: Number(form.priority || 1),
      priceRate: Number(form.priceRate || 1),
      balance: Number(form.balance || 0),
      isPublicBeta: form.isPublicBeta,
      betaFreeUntil: form.isPublicBeta ? form.betaFreeUntil : undefined,
      betaLabel: form.isPublicBeta ? form.betaLabel.trim() : undefined,
      ...modelPayload,
    };

    try {
      if (editing) {
        await adminApi.updateChannel(editing.id, payload);
      } else {
        await adminApi.createChannel(payload);
      }
      resetForm();
      await loadChannels();
    } catch (saveError) {
      console.error('Failed to save channel', saveError);
      setError(getApiErrorMessage(saveError, '渠道保存失败，请检查填写内容后重试。'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncPricing() {
    if (!editing?.id) {
      setError('请先保存渠道，再执行价格同步。');
      return;
    }

    setSyncingPricing(true);
    setError('');
    try {
      await adminApi.syncChannelOpencodePricing(editing.id);
      const [channelsResponse, presetsResponse, pricingResponse] = await Promise.all([
        adminApi.getChannels(),
        adminApi.getChannelModelPresets(),
        adminApi.getOpencodeZenPricing(),
      ]);
      const nextChannels = channelsResponse.data || [];
      setChannels(nextChannels);
      setPresets(presetsResponse.data?.data || []);
      setPricingReference(pricingResponse.data?.data || null);
      const refreshed = nextChannels.find((channel: ChannelRecord) => channel.id === editing.id);
      if (refreshed) {
        startEdit(refreshed);
      }
    } catch (syncError) {
      console.error('Failed to sync pricing', syncError);
      setError(getApiErrorMessage(syncError, '价格同步失败，请稍后重试。'));
    } finally {
      setSyncingPricing(false);
    }
  }

  function formatPrice(value?: number | string) {
    const num = Number(value ?? 0);
    if (!Number.isFinite(num)) return '$0';
    return `$${num.toFixed(num >= 1 ? 2 : 4)}`;
  }

  function getMarginLabel(modelName: string, retailInput: string) {
    const reference = pricingReferenceMap.get(modelName.trim());
    if (!reference) return '自定义';
    if (Number(reference.official.inputPrice) === 0 && Number(reference.retail.inputPrice) === 0) return '免费';
    const ratio = reference.official.inputPrice > 0 ? ((reference.retail.inputPrice / reference.official.inputPrice) - 1) * 100 : 0;
    const current = Number(retailInput || 0);
    const diff = Math.abs(current - Number(reference.retail.inputPrice));
    if (diff < 0.0001) return `${ratio.toFixed(0)}%`;
    if (reference.official.inputPrice <= 0) return '自定义';
    return `${(((current / reference.official.inputPrice) - 1) * 100).toFixed(0)}%`;
  }

  function modelBrandBadge(modelName: string) {
    const brand = inferBrand(modelName);
    return (
      <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${brand.tone}`}>
        {brand.label}
      </span>
    );
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="rounded-3xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">正在加载渠道配置...</div>
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
                <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Routing</div>
                <h1 className="mt-2 text-3xl font-semibold text-slate-950">渠道管理</h1>
                <div className="mt-2 text-sm text-slate-500">统一管理模型渠道、已部署模型、缓存价格和单模型测试结果。</div>
              </div>
            </div>
            <button onClick={resetForm} className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black">
              <Plus className="h-4 w-4" />新建渠道
            </button>
          </header>

          <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-[24px] border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">渠道总数</div><div className="mt-2 text-2xl font-semibold text-slate-950">{channels.length}</div></div>
                <div className="rounded-[24px] border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">启用中</div><div className="mt-2 text-2xl font-semibold text-slate-950">{activeCount}</div></div>
                <div className="rounded-[24px] border border-slate-200 bg-white p-5"><div className="text-sm text-slate-500">模型条目</div><div className="mt-2 text-2xl font-semibold text-slate-950">{channels.reduce((sum, channel) => sum + (channel.modelConfigs?.length || channel.models.length || 0), 0)}</div></div>
              </div>

              {channels.map((channel) => (
                <div key={channel.id} className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3"><Cpu className="h-5 w-5 text-sky-600" /></div>
                        <div><div className="text-lg font-medium text-slate-950">{channel.name}</div><div className="text-sm text-slate-500">{channel.channelType}</div></div>
                        <span className={`rounded-full px-3 py-1 text-xs font-medium ${channel.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}`}>{channel.isActive ? '已启用' : '已停用'}</span>
                        {channel.isPublicBeta ? <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">{channel.betaLabel || '内测免费'} 至 {channel.betaFreeUntil || '2026-04-15'}</span> : null}
                      </div>
                      <div className="mt-4 text-sm text-slate-500">{channel.baseUrl}</div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {channel.models.map((model) => (
                          <div key={model} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">
                            {modelBrandBadge(model)}
                            <span>{model}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => startEdit(channel)} className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300">编辑</button>
                  </div>
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm text-slate-500">优先级</div><div className="mt-2 text-xl font-semibold text-slate-950">{channel.priority}</div></div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm text-slate-500">价格倍率</div><div className="mt-2 text-xl font-semibold text-slate-950">{Number(channel.priceRate).toFixed(2)}</div></div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4"><div className="text-sm text-slate-500">渠道余额</div><div className="mt-2 text-xl font-semibold text-slate-950">${Number(channel.balance).toFixed(2)}</div></div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.04)]">
              <div className="text-sm font-medium text-slate-900">{editing ? '编辑渠道' : '新建渠道'}</div>
              <div className="mt-2 text-sm text-slate-500">支持一键铺模型、单模型测试、协议指定，以及缓存读写价格。</div>

              {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

              <div className="mt-5 space-y-4">
                <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="渠道名称" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                <select value={form.channelType} onChange={(event) => setForm({ ...form, channelType: event.target.value })} className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none">
                  <option value="openai">openai</option>
                  <option value="anthropic">anthropic</option>
                  <option value="azure">azure</option>
                  <option value="custom">custom</option>
                </select>
                <input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="Base URL" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                <input value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="渠道 API Key" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />

                <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-4">
                  <label className="flex items-center gap-3 text-sm font-medium text-slate-900">
                    <input type="checkbox" checked={form.isPublicBeta} onChange={(event) => setForm({ ...form, isPublicBeta: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                    开启站内内测免费通道
                  </label>
                  {form.isPublicBeta ? <div className="mt-4 grid gap-3 md:grid-cols-2"><input type="date" value={form.betaFreeUntil} onChange={(event) => setForm({ ...form, betaFreeUntil: event.target.value })} className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-slate-900 outline-none" /><input value={form.betaLabel} onChange={(event) => setForm({ ...form, betaLabel: event.target.value })} placeholder="内测免费" className="rounded-2xl border border-amber-200 bg-white px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" /></div> : null}
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div><div className="text-sm font-medium text-slate-900">模型配置</div><div className="mt-1 text-sm text-slate-500">一键部署推荐模型，或单独添加模型并指定协议与价格。</div></div>
                    <div className="flex flex-wrap items-center gap-2">
                      {editing ? <button type="button" onClick={() => void handleSyncPricing()} disabled={syncingPricing} className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-700 transition hover:border-violet-300 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${syncingPricing ? 'animate-spin' : ''}`} />{syncingPricing ? '同步中...' : '按平台基准同步价格'}</button> : null}
                      <button type="button" onClick={applyRecommendedPresets} className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700 transition hover:border-sky-300"><Cpu className="h-4 w-4" />一键部署推荐模型</button>
                      <button type="button" onClick={addRow} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300"><Plus className="h-4 w-4" />添加模型</button>
                    </div>
                  </div>

                  {pricingReference ? <div className="mt-4 rounded-[22px] border border-violet-200 bg-violet-50/60 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <div className="text-sm font-medium text-slate-900">模型价格基准</div>
                        <div className="mt-1 text-sm text-slate-500">当前零售价默认按平台基准自动换算，你也可以手动调整。</div>
                      </div>
                      <div className="rounded-full border border-violet-200 bg-white px-3 py-1 text-xs font-medium text-violet-700">已收录 {pricingReference.rows.length} 个基准模型</div>
                    </div>
                  </div> : null}

                  {recommendedPresets.length ? <div className="mt-4 rounded-[22px] border border-slate-200 bg-white p-4"><div className="text-sm font-medium text-slate-900">模型预设库</div><div className="mt-1 text-sm text-slate-500">点击标签即可把预设模型追加到当前渠道。</div><div className="mt-3 flex flex-wrap gap-2">{recommendedPresets.slice(0, 18).map((preset) => <button key={preset.id} type="button" onClick={() => applyPreset(preset)} title={preset.summary} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition hover:border-slate-300 hover:bg-white">{modelBrandBadge(preset.id)}<span>{preset.label}</span></button>)}</div></div> : null}

                  <div className="mt-4 space-y-3">
                    {modelRows.map((row, index) => (
                      <div key={`${row.modelName}-${index}`} className="rounded-[22px] border border-slate-200 bg-white p-4">
                        {(() => {
                          const reference = pricingReferenceMap.get(row.modelName.trim());
                          return reference ? (
                            <div className="mb-3 grid gap-3 rounded-[20px] border border-violet-200 bg-violet-50/60 p-3 md:grid-cols-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">基准价格</div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>输入 {formatPrice(reference.official.inputPrice)}</div>
                                  <div>输出 {formatPrice(reference.official.outputPrice)}</div>
                                  <div>写缓存 {formatPrice(reference.official.cacheWritePrice)}</div>
                                  <div>读缓存 {formatPrice(reference.official.cacheReadPrice)}</div>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">平台零售价</div>
                                <div className="mt-2 space-y-1 text-sm text-slate-700">
                                  <div>输入 {formatPrice(reference.retail.inputPrice)}</div>
                                  <div>输出 {formatPrice(reference.retail.outputPrice)}</div>
                                  <div>写缓存 {formatPrice(reference.retail.cacheWritePrice)}</div>
                                  <div>读缓存 {formatPrice(reference.retail.cacheReadPrice)}</div>
                                </div>
                              </div>
                              <div>
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">价差比例</div>
                                <div className="mt-2 text-2xl font-semibold text-slate-950">{getMarginLabel(row.modelName, row.inputPrice)}</div>
                                <div className="mt-2 text-sm text-slate-500">如果你手动改价，这里会按当前输入价重新计算当前价差。</div>
                              </div>
                            </div>
                          ) : (
                            <div className="mb-3 rounded-[20px] border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                              这个模型当前没有匹配到平台价格基准，将按你手动输入的零售价生效。
                            </div>
                          );
                        })()}
                        <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr_auto_auto]">
                          <input value={row.modelName} onChange={(event) => updateRow(index, { modelName: event.target.value })} placeholder="模型 ID，例如 gpt-5.4" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                          <select value={row.protocol} onChange={(event) => updateRow(index, { protocol: event.target.value })} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none">
                            <option value="auto">auto</option><option value="openai">openai</option><option value="openai-responses">openai / responses</option><option value="anthropic">anthropic / claude</option><option value="gemini">gemini</option>
                          </select>
                          <input type="number" step="0.0001" value={row.inputPrice} onChange={(event) => updateRow(index, { inputPrice: event.target.value })} placeholder="输入价 / 1M" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                          <input type="number" step="0.0001" value={row.outputPrice} onChange={(event) => updateRow(index, { outputPrice: event.target.value })} placeholder="输出价 / 1M" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                          <input type="number" step="0.0001" value={row.cacheWritePrice} onChange={(event) => updateRow(index, { cacheWritePrice: event.target.value })} placeholder="Cache write" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                          <input type="number" step="0.0001" value={row.cacheReadPrice} onChange={(event) => updateRow(index, { cacheReadPrice: event.target.value })} placeholder="Cache read" className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
                          <button type="button" onClick={() => void handleTestModel(row)} disabled={testingModel} className="inline-flex items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 transition hover:border-emerald-300 disabled:opacity-60"><TestTube2 className="h-4 w-4" /></button>
                          <button type="button" onClick={() => removeRow(index)} className="inline-flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-500 transition hover:border-rose-200 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                        {row.modelName.trim() ? <div className="mt-3 flex items-center gap-2">{modelBrandBadge(row.modelName)}</div> : null}
                        <label className="mt-3 flex items-center gap-2 text-sm text-slate-500"><input type="checkbox" checked={row.isActive} onChange={(event) => updateRow(index, { isActive: event.target.checked })} className="h-4 w-4 rounded border-slate-300" />当前模型启用</label>
                      </div>
                    ))}
                  </div>
                </div>

                {(modelTestError || modelTestResult) ? <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"><div className="text-sm font-medium text-slate-900">单模型测试结果</div>{modelTestError ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{modelTestError}</div> : null}{modelTestResult ? <div className="mt-3 space-y-3"><div className={`rounded-2xl px-4 py-3 text-sm ${modelTestResult.success ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'}`}>{modelTestResult.success ? '测试成功' : '测试失败'}：{modelTestResult.modelName}<span className="ml-2 text-xs uppercase tracking-[0.18em]">{modelTestResult.protocol}</span>{modelTestResult.status ? <span className="ml-2">HTTP {modelTestResult.status}</span> : null}</div><pre className="max-h-72 overflow-auto rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-6 text-slate-700">{JSON.stringify(modelTestResult.success ? modelTestResult.response : modelTestResult.error || { message: modelTestResult.message }, null, 2)}</pre></div> : null}</div> : null}

                <div className="grid gap-3 md:grid-cols-3">
                  <input type="number" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} placeholder="优先级" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none" />
                  <input type="number" step="0.01" value={form.priceRate} onChange={(event) => setForm({ ...form, priceRate: event.target.value })} placeholder="价格倍率" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none" />
                  <input type="number" step="0.01" value={form.balance} onChange={(event) => setForm({ ...form, balance: event.target.value })} placeholder="渠道余额" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none" />
                </div>

                <div className="flex gap-3">
                  <button onClick={() => void handleSubmit()} disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition hover:bg-black disabled:opacity-60">{editing ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}{saving ? '保存中...' : editing ? '保存渠道' : '创建渠道'}</button>
                  {editing ? <button onClick={resetForm} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 transition hover:border-slate-300"><X className="h-4 w-4" />取消编辑</button> : null}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
