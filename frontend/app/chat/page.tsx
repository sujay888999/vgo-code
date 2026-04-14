'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowUp,
  BookOpen,
  Bot,
  Check,
  Copy,
  Loader2,
  LogOut,
  MessageSquare,
  Package2,
  PanelLeft,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Wrench,
} from 'lucide-react';
import { chatApi, getApiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/lib/store';
import SiteLogo from '@/components/site-logo';

type Conversation = {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string;
};

type ChatModel = {
  id: string;
  name: string;
  provider?: string;
  isPublicBetaFree?: boolean;
  betaFreeUntil?: string | null;
};

type ToolTrace = {
  name: string;
  label: string;
  status?: 'success' | 'error';
  resultSummary?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt?: string;
  toolTraces?: ToolTrace[];
};

type DisplayMessage = ChatMessage & {
  displayContent: string;
  parsedToolTraces: ToolTrace[];
};

const CHAT_TOOL_LABELS: Record<string, string> = {
  get_my_profile: '账户资料',
  get_my_balance: '余额查询',
  list_available_models: '模型目录',
  get_recent_recharges: '最近充值',
  get_usage_summary: '用量汇总',
  get_recharge_packages: '充值套餐',
  preview_recharge_bonus: '赠送预估',
  describe_payment_methods: '支付方式',
  recommend_recharge_package: '充值推荐',
  create_recharge_order: '创建充值订单',
  get_recharge_order_status: '查询充值订单',
  admin_list_channels: '渠道状态',
  admin_recent_request_errors: '错误请求',
  admin_platform_overview: '平台概览',
  admin_model_health_summary: '模型健康度',
  admin_channel_diagnostics: '渠道诊断',
  admin_incident_analysis: '异常分析',
};

function parseAgentMessage(message: ChatMessage): DisplayMessage {
  const pattern = /\n\n\[Agent tools used: ([^\]]+)\]\s*$/;
  const match = message.content.match(pattern);
  const parsedToolTraces =
    message.toolTraces?.length
      ? message.toolTraces
      : match?.[1]
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .map((name) => ({
            name,
            label: CHAT_TOOL_LABELS[name] || name,
            status: 'success' as const,
            resultSummary: '',
          })) || [];

  return {
    ...message,
    displayContent: match ? message.content.replace(pattern, '').trim() : message.content,
    parsedToolTraces,
  };
}

export default function ChatPage() {
  const { user, isAuthenticated, isLoading: authLoading, checkAuth, logout } = useAuthStore();
  const router = useRouter();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingWorkspace, setLoadingWorkspace] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('vgo-cs');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');

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
      void loadWorkspace();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) || null,
    [conversations, currentConversationId],
  );
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) || null,
    [models, selectedModelId],
  );
  const displayMessages = useMemo(() => messages.map(parseAgentMessage), [messages]);

  async function loadWorkspace() {
    setLoadingWorkspace(true);
    setError('');

    try {
      await Promise.all([loadModels(), loadConversations()]);
    } catch (e: any) {
      setError(getApiErrorMessage(e, '加载聊天工作台失败，请稍后再试。'));
    } finally {
      setLoadingWorkspace(false);
    }
  }

  async function loadModels() {
    const nextModels = (await chatApi.getModels()).data.data as ChatModel[];
    
    // Ensure vgo-cs is always available (even if hidden from public catalog)
    const vgoCSModel: ChatModel = {
      id: 'vgo-cs',
      name: 'VGO智能客服',
      provider: 'VGO',
      isPublicBetaFree: true,
      betaFreeUntil: null,
    };
    
    // Add vgo-cs if not already in the list
    const hasVgoCS = nextModels.some(m => m.id === 'vgo-cs');
    const modelsWithVgoCS = hasVgoCS ? nextModels : [vgoCSModel, ...nextModels];
    
    // Put vgo-cs at the beginning of the list
    const sortedModels = [...modelsWithVgoCS].sort((a, b) => {
      if (a.id === 'vgo-cs') return -1;
      if (b.id === 'vgo-cs') return 1;
      return a.name.localeCompare(b.name);
    });
    
    setModels(sortedModels);

    // Always set vgo-cs as the default
    setSelectedModelId('vgo-cs');
  }

  async function loadConversations() {
    const nextConversations = (await chatApi.getConversations()).data.data as Conversation[];
    setConversations(nextConversations);

    if (
      currentConversationId &&
      nextConversations.length &&
      !nextConversations.some((conversation) => conversation.id === currentConversationId)
    ) {
      setCurrentConversationId(null);
      setMessages([]);
      await openConversation(nextConversations[0].id);
      return;
    }

    if (!currentConversationId && nextConversations.length) {
      await openConversation(nextConversations[0].id);
    } else if (!nextConversations.length) {
      setCurrentConversationId(null);
      setMessages([]);
    }
  }

  async function openConversation(id: string) {
    try {
      setCurrentConversationId(id);
      setMessages((await chatApi.getMessages(id)).data.data as ChatMessage[]);
    } catch (e: any) {
      const message = getApiErrorMessage(e, '');
      const status = e?.response?.status;
      if (status === 404) {
        setCurrentConversationId(null);
        setMessages([]);
        await loadConversations();
        return;
      }

      setError(message || '加载会话失败，请稍后再试。');
    }
  }

  async function submitMessage(rawContent: string) {
    const content = rawContent.trim();
    if (!content || sending) return;

    const optimisticMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content,
    };

    const nextMessages = [...messages, optimisticMessage];
    setMessages(nextMessages);
    setInput('');
    setSending(true);
    setError('');

    try {
      let payload: any;
      try {
        payload = (
          await chatApi.sendMessage({
            conversationId: currentConversationId || undefined,
            model: selectedModelId,
            messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
          })
        ).data.data;
      } catch (e: any) {
        if (e?.response?.status === 404 && currentConversationId) {
          setCurrentConversationId(null);
          payload = (
            await chatApi.sendMessage({
              model: selectedModelId,
              messages: nextMessages.map((message) => ({ role: message.role, content: message.content })),
            })
          ).data.data;
        } else {
          throw e;
        }
      }

      const assistantMessage: ChatMessage = {
        ...(payload.message as ChatMessage),
        toolTraces: payload.toolTraces as ToolTrace[] | undefined,
      };

      setCurrentConversationId((payload.conversation as Conversation).id);
      setMessages((previous) => [...previous.slice(0, -1), optimisticMessage, assistantMessage]);
      await loadConversations();
    } catch (e: any) {
      const message = getApiErrorMessage(e, '模型响应失败，请稍后重试。');
      setError(message);
      setMessages((previous) => [...previous, { id: `error-${Date.now()}`, role: 'assistant', content: message }]);
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteConversation(id: string) {
    try {
      await chatApi.deleteConversation(id);
      if (id === currentConversationId) {
        setCurrentConversationId(null);
        setMessages([]);
      }
      await loadConversations();
    } catch (e: any) {
      setError(getApiErrorMessage(e, '删除会话失败，请稍后再试。'));
    }
  }

  function handleLogout() {
    logout();
    router.replace('/');
  }

  async function handleCopy(content: string, id: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1200);
    } catch {}
  }

  const navLinks = [
    { href: '/dashboard', label: '账户中心', icon: Settings },
    { href: '/models', label: '模型目录', icon: Package2 },
    { href: '/teams', label: 'VGO-CODE', icon: Wrench },
    { href: '/skills', label: '技能安装', icon: Sparkles },
    { href: '/developers', label: '接入文档', icon: BookOpen },
  ];

  if (user?.isAdmin) {
    navLinks.push({ href: '/admin', label: '管理后台', icon: Shield });
  }

  if (authLoading || !isAuthenticated || loadingWorkspace) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f7f8]">
        <div className="inline-flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-600 shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在进入聊天工作台...
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f7f8] px-3 py-3 md:px-4 md:py-4">
      <aside
        className={`mr-3 flex h-full shrink-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-[#f3f4f6] transition-all duration-300 ${
          sidebarOpen ? 'w-[300px]' : 'w-[88px]'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-3 overflow-hidden">
            <SiteLogo size="md" priority />
            {sidebarOpen ? (
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold tracking-[0.12em] text-slate-900">VGO AI</div>
                <div className="truncate text-sm text-slate-500">聊天工作台</div>
              </div>
            ) : null}
          </div>

          <button
            onClick={() => setSidebarOpen((value) => !value)}
            className="rounded-2xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-slate-900"
          >
            <PanelLeft className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 py-4">
          <button
            onClick={() => {
              setCurrentConversationId(null);
              setMessages([]);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 font-medium text-slate-900 transition hover:border-slate-300"
          >
            <Plus className="h-4 w-4" />
            {sidebarOpen ? '新建对话' : null}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          {!conversations.length ? (
            <div className="px-3 py-4 text-sm leading-6 text-slate-500">这里还没有历史会话，直接开始一条新消息即可。</div>
          ) : (
            <div className="space-y-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => void openConversation(conversation.id)}
                  className={`group flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition ${
                    currentConversationId === conversation.id ? 'bg-white shadow-sm' : 'hover:bg-white/70'
                  }`}
                >
                  <div className="min-w-0">
                    {sidebarOpen ? (
                      <>
                        <div className="truncate text-sm font-medium text-slate-900">{conversation.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{conversation.messageCount} 条消息</div>
                      </>
                    ) : (
                      <MessageSquare className="h-4 w-4 text-slate-500" />
                    )}
                  </div>

                  {sidebarOpen ? (
                    <span
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteConversation(conversation.id);
                      }}
                      className="rounded-xl p-2 text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-rose-500 group-hover:opacity-100"
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4">
          {sidebarOpen ? (
            <div className="space-y-3">
              <div className="rounded-3xl border border-slate-200 bg-white p-4">
                <div className="text-sm font-medium text-slate-900">{user?.username || 'VGO AI 用户'}</div>
                <div className="mt-1 truncate text-xs text-slate-500">{user?.email}</div>
              </div>

              <div className="rounded-3xl border border-slate-200 bg-white p-3">
                <div className="mb-2 px-2 text-xs uppercase tracking-[0.18em] text-slate-400">导航</div>
                <div className="space-y-1">
                  {navLinks.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
                      >
                        <Icon className="h-4 w-4" />
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={handleLogout}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 hover:text-slate-950"
              >
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {navLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                );
              })}

              <button
                onClick={handleLogout}
                className="flex w-full items-center justify-center rounded-2xl border border-slate-200 bg-white p-3 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="flex h-full flex-1 flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Conversation</div>
            <div className="mt-1 text-xl font-semibold text-slate-950">{selectedConversation?.title || '新的对话'}</div>
            <div className="mt-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
              {user?.isAdmin ? 'Admin Agent: 自动启用管理员能力' : 'User Agent: 自动启用用户能力'}
            </div>
            {selectedModelId === 'vgo-cs' ? (
              <div className="mt-2 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                VGO智能客服 - 完全免费
              </div>
            ) : null}
          </div>

          <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <select
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              className="bg-transparent outline-none"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id} className="bg-white text-slate-900">
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        </header>

        {error ? <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="flex-1 overflow-y-auto px-4 py-5 md:px-8">
          {!displayMessages.length ? (
            <div className="mx-auto flex h-full max-w-4xl flex-col items-center justify-center">
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                VGO AI Workspace
              </div>
              <h1 className="mt-6 text-center text-4xl font-semibold text-slate-950">今天想处理什么内容？</h1>
              <p className="mt-4 max-w-2xl text-center text-base leading-7 text-slate-500">
                {user?.isAdmin
                  ? '你当前使用的是管理员上下文，系统会自动开放平台排查、渠道诊断和运营辅助能力。'
                  : '你当前使用的是普通用户上下文，系统会自动开放账户、充值、订单和模型相关能力。'}
              </p>
            </div>
          ) : (
            <div className="mx-auto max-w-4xl space-y-6">
              {displayMessages.map((message) => (
                <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[85%] rounded-[28px] px-5 py-4 ${
                      message.role === 'user' ? 'bg-[#111827] text-white' : 'bg-[#f7f7f8] text-slate-900'
                    }`}
                  >
                    {message.parsedToolTraces.length ? (
                      <div className="mb-3 flex flex-wrap gap-2">
                        {message.parsedToolTraces.map((trace, index) => (
                          <span
                            key={`${message.id}-${trace.name}-${index}`}
                            className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
                              trace.status === 'error'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : 'border-emerald-200 bg-white text-emerald-700'
                            }`}
                          >
                            <Wrench className="h-3 w-3" />
                            {trace.label}
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="whitespace-pre-wrap text-[15px] leading-7">{message.displayContent}</div>

                    {message.parsedToolTraces.length ? (
                      <div className="mt-3 space-y-2">
                        {message.parsedToolTraces.map((trace, index) => (
                          <div
                            key={`${message.id}-trace-${index}`}
                            className="rounded-2xl border border-slate-200 bg-white/90 px-3 py-2 text-xs text-slate-600"
                          >
                            <span className="font-medium text-slate-800">{trace.label}：</span>
                            {trace.resultSummary || '工具已执行'}
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {message.role === 'assistant' ? (
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => void handleCopy(message.displayContent, message.id)}
                          className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:text-slate-900"
                        >
                          {copiedId === message.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-4 py-4 md:px-8">
          <div className="mx-auto max-w-4xl rounded-[28px] border border-slate-200 bg-[#f7f7f8] p-4">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submitMessage(input);
                }
              }}
              placeholder="向 VGO AI 发送消息"
              className="min-h-[120px] w-full resize-none bg-transparent text-[15px] text-slate-900 outline-none placeholder:text-slate-400"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="text-xs text-slate-500">Enter 发送，Shift + Enter 换行</div>
              <button
                onClick={() => void submitMessage(input)}
                disabled={!input.trim() || sending}
                className="inline-flex items-center gap-2 rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                发送
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
