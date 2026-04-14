'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Copy, Loader2, ReceiptText } from 'lucide-react';
import { gatewayApi } from '@/lib/api';

interface CatalogItem {
  id: string;
  label: string;
  summary: string;
  family: string;
  tags: string[];
  protocol?: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  cacheWritePricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  routeType: 'chat';
  status: 'active';
}

type BrandMeta = {
  label: string;
  domain: string;
};

const BRAND_RULES: Array<{ match: RegExp; meta: BrandMeta }> = [
  { match: /(minimax|abab|minimax-m)/i, meta: { label: 'MiniMax', domain: 'minimaxi.com' } },
  { match: /(anthropic|claude)/i, meta: { label: 'Anthropic', domain: 'anthropic.com' } },
  { match: /(google|gemini)/i, meta: { label: 'Google Gemini', domain: 'gemini.google.com' } },
  { match: /(moonshot|kimi)/i, meta: { label: 'Moonshot', domain: 'moonshot.cn' } },
  { match: /(zhipu|glm)/i, meta: { label: 'Zhipu', domain: 'bigmodel.cn' } },
  { match: /(nvidia|nemotron)/i, meta: { label: 'NVIDIA', domain: 'nvidia.com' } },
  { match: /(qwen|tongyi|alibaba)/i, meta: { label: 'Qwen', domain: 'tongyi.aliyun.com' } },
  { match: /(openai|gpt|codex|o1|o3|o4)/i, meta: { label: 'OpenAI', domain: 'openai.com' } },
];

function inferBrand(model: CatalogItem): BrandMeta {
  const target = `${model.label} ${model.id} ${model.family}`;
  const match = BRAND_RULES.find((rule) => rule.match.test(target));
  if (match) return match.meta;
  return { label: model.family || 'Other', domain: '' };
}

function formatPrice(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-';
  if (value === 0) return '$0';
  return `$${value.toFixed(value >= 1 ? 2 : 4)}/M`;
}

function familyBadgeColor(family: string) {
  const key = family.toLowerCase();
  if (key.includes('openai')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (key.includes('anthropic')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (key.includes('google')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (key.includes('zhipu')) return 'bg-cyan-50 text-cyan-700 border-cyan-200';
  if (key.includes('moonshot')) return 'bg-violet-50 text-violet-700 border-violet-200';
  if (key.includes('nvidia')) return 'bg-lime-50 text-lime-700 border-lime-200';
  if (key.includes('minimax')) return 'bg-rose-50 text-rose-700 border-rose-200';
  if (key.includes('qwen')) return 'bg-orange-50 text-orange-700 border-orange-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function tagColor(tag: string) {
  const key = tag.toLowerCase();
  if (key.includes('chat')) return 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200';
  if (key.includes('code') || key.includes('developer') || key.includes('coding')) {
    return 'bg-sky-50 text-sky-700 border-sky-200';
  }
  if (key.includes('reasoning') || key.includes('analysis') || key.includes('thinking')) {
    return 'bg-cyan-50 text-cyan-700 border-cyan-200';
  }
  if (key.includes('multimodal') || key.includes('vision') || key.includes('image')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (key.includes('cn')) return 'bg-orange-50 text-orange-700 border-orange-200';
  if (key.includes('fast') || key.includes('mini') || key.includes('nano')) {
    return 'bg-lime-50 text-lime-700 border-lime-200';
  }
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function compactSummary(summary: string) {
  if (!summary) return '适合统一 API 网关接入的标准模型。';
  return summary.length > 72 ? `${summary.slice(0, 72)}...` : summary;
}

function groupModels(models: CatalogItem[]) {
  return models.reduce<Record<string, CatalogItem[]>>((acc, model) => {
    const key = inferBrand(model).label || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(model);
    return acc;
  }, {});
}

function BrandLogo({ model }: { model: CatalogItem }) {
  const brand = inferBrand(model);
  const [failed, setFailed] = useState(false);
  const src = brand.domain ? `https://www.google.com/s2/favicons?domain=${brand.domain}&sz=128` : '';

  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {!failed && src ? (
        <img
          src={src}
          alt={brand.label}
          className="h-8 w-8 object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-sm font-semibold text-slate-700">{brand.label.slice(0, 2).toUpperCase()}</span>
      )}
    </div>
  );
}

function ModelCard({ model }: { model: CatalogItem }) {
  const [copied, setCopied] = useState(false);
  const brand = inferBrand(model);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(model.id);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error('Failed to copy model id', error);
    }
  }

  return (
    <article className="flex h-full min-h-[236px] flex-col rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_10px_28px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.08)]">
      <div className="flex items-start gap-3">
        <BrandLogo model={model} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[1.03rem] font-semibold leading-6 text-slate-950">{model.label}</div>
              <div className="mt-1 break-all text-[11px] leading-5 text-slate-400">{model.id}</div>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              title="复制模型 ID"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${familyBadgeColor(brand.label)}`}>
              {brand.label}
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {String(model.protocol || 'auto').toUpperCase()}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              按量计费
            </span>
            {copied ? (
              <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700">
                已复制
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <div className="text-slate-500">输入价格</div>
          <div className="mt-1 font-semibold text-slate-950">{formatPrice(model.inputPricePerMillion)}</div>
        </div>
        <div>
          <div className="text-slate-500">输出价格</div>
          <div className="mt-1 font-semibold text-slate-950">{formatPrice(model.outputPricePerMillion)}</div>
        </div>
        <div>
          <div className="text-slate-500">缓存读取</div>
          <div className="mt-1 font-semibold text-slate-900">{formatPrice(model.cacheReadPricePerMillion)}</div>
        </div>
        <div>
          <div className="text-slate-500">缓存写入</div>
          <div className="mt-1 font-semibold text-slate-900">{formatPrice(model.cacheWritePricePerMillion)}</div>
        </div>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-slate-600">{compactSummary(model.summary)}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {model.tags.slice(0, 4).map((tag) => (
          <span key={tag} className={`rounded-full border px-2.5 py-1 text-[11px] ${tagColor(tag)}`}>
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

export default function ModelsPage() {
  const [models, setModels] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCatalog() {
      try {
        const response = await gatewayApi.getModelCatalog();
        setModels(response.data?.data || []);
      } catch (error) {
        console.error('Failed to load model catalog', error);
      } finally {
        setLoading(false);
      }
    }

    void loadCatalog();
  }, []);

  const grouped = useMemo(() => groupModels(models), [models]);
  const orderedFamilies = useMemo(
    () => Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0])),
    [grouped],
  );

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="rounded-[32px] border border-slate-200 bg-white/90 p-5 shadow-[0_22px_60px_rgba(15,23,42,0.06)] backdrop-blur md:p-6">
          <header className="flex flex-col gap-5 border-b border-slate-200 pb-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-4xl">
              <div className="flex items-center gap-3">
                <Link
                  href="/chat"
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="text-xs uppercase tracking-[0.28em] text-slate-500">Model Catalog</div>
              </div>
              <h1 className="mt-4 text-4xl font-semibold tracking-[-0.06em] text-slate-950 md:text-5xl">可用模型</h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-slate-600">
                这里集中展示当前已接入并可调用的模型，包含输入、输出、缓存读取与缓存写入价格，方便开发接入与快速选型。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">API Base URL</div>
                <div className="mt-2 break-all font-mono text-sm text-slate-900">https://vgoai.cn/api/v1/gateway/v1</div>
              </div>
              <Link
                href="/developers"
                className="flex items-center justify-between rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4 text-slate-700 transition hover:border-slate-300 hover:bg-white"
              >
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Docs</div>
                  <div className="mt-2 text-sm font-medium text-slate-950">查看接入文档</div>
                </div>
                <ReceiptText className="h-4 w-4" />
              </Link>
            </div>
          </header>

          {loading ? (
            <div className="mt-8 flex items-center gap-3 rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              正在读取模型目录...
            </div>
          ) : !models.length ? (
            <div className="mt-8 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-slate-600">
              当前还没有可展示的模型，请先在后台接入渠道并启用模型。
            </div>
          ) : (
            <div className="mt-8 space-y-8">
              {orderedFamilies.map(([family, familyModels]) => (
                <section key={family}>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <h2 className="text-xl font-semibold text-slate-950">{family}</h2>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-500">
                        {familyModels.length} 个
                      </span>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                    {familyModels.map((model) => (
                      <ModelCard key={model.id} model={model} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
