import { create } from 'zustand'

type Locale = 'zh-CN' | 'en-US'

const translations: Record<Locale, Record<string, string>> = {
  'zh-CN': {
    'app.title': 'VGO Code',
    'app.subtitle': '智能编码助手',
    'sidebar.newChat': '新会话',
    'sidebar.search': '搜索会话…',
    'sidebar.currentModel': '当前模型',
    'sidebar.noModels': '暂无可用模型',
    'sidebar.loginHint': '登录 VGO AI 后同步云端模型配置',
    'composer.placeholder': '输入消息，或按 / 触发模板…',
    'composer.attach': '附件',
    'composer.send': '发送',
    'composer.stop': '停止',
    'settings.title': '设置',
    'settings.appearance': '外观',
    'settings.language': '语言',
    'settings.behavior': '行为',
    'settings.agent': 'Agent',
    'settings.runtime': '模型',
    'settings.theme': '主题',
    'settings.theme.aurora': 'Aurora',
    'settings.theme.paper': 'Paper Light',
    'settings.theme.graphite': 'Graphite',
    'settings.theme.solar': 'Solar',
    'settings.locale': '界面语言',
    'settings.compact': '紧凑模式',
    'settings.enterToSend': 'Enter 发送',
    'settings.autoScroll': '自动滚动',
    'settings.taskPanel': '显示任务面板',
    'settings.confirmDanger': '危险操作确认',
    'task.title': '任务',
    'task.planning': '规划中…',
    'task.thinking': '思考中…',
    'task.running': '运行工具',
    'task.completed': '任务完成',
    'task.error': '执行失败',
    'permission.default': '默认',
    'permission.full': '完全访问',
    'scope.workspace': '工作区',
    'scope.global': '工作区 + 桌面',
  },
  'en-US': {
    'app.title': 'VGO Code',
    'app.subtitle': 'AI Coding Assistant',
    'sidebar.newChat': 'New Chat',
    'sidebar.search': 'Search sessions…',
    'sidebar.currentModel': 'Current Model',
    'sidebar.noModels': 'No models available',
    'sidebar.loginHint': 'Log in to sync cloud models',
    'composer.placeholder': 'Type a message, or press / for templates…',
    'composer.attach': 'Attach',
    'composer.send': 'Send',
    'composer.stop': 'Stop',
    'settings.title': 'Settings',
    'settings.appearance': 'Appearance',
    'settings.language': 'Language',
    'settings.behavior': 'Behavior',
    'settings.agent': 'Agent',
    'settings.runtime': 'Runtime',
    'settings.theme': 'Theme',
    'settings.theme.aurora': 'Aurora',
    'settings.theme.paper': 'Paper Light',
    'settings.theme.graphite': 'Graphite',
    'settings.theme.solar': 'Solar',
    'settings.locale': 'Interface Language',
    'settings.compact': 'Compact Mode',
    'settings.enterToSend': 'Enter to Send',
    'settings.autoScroll': 'Auto Scroll',
    'settings.taskPanel': 'Show Task Panel',
    'settings.confirmDanger': 'Confirm Dangerous Ops',
    'task.title': 'Tasks',
    'task.planning': 'Planning…',
    'task.thinking': 'Thinking…',
    'task.running': 'Running tool',
    'task.completed': 'Completed',
    'task.error': 'Failed',
    'permission.default': 'Default',
    'permission.full': 'Full Access',
    'scope.workspace': 'Workspace',
    'scope.global': 'Workspace + Desktop',
  },
}

interface I18nStore {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string) => string
}

export const useI18n = create<I18nStore>((set, get) => ({
  locale: 'zh-CN',
  setLocale: (locale) => set({ locale }),
  t: (key) => translations[get().locale][key] || key,
}))

export function setI18nLocale(locale: Locale) {
  useI18n.getState().setLocale(locale)
}
