import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import { ModelSelector } from './ModelSelector'
import { AuthPanel } from './AuthPanel'
import {
  FolderOpen,
  Settings,
  Plus,
  Search,
  Pin,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react'

export function Sidebar() {
  const { t, locale } = useI18n()
  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    hydrate,
    setSettingsOverlayOpen,
    setRenameOverlayOpen,
    workspace,
  } = useAppStore()

  const [sessionSearch, setSessionSearch] = useState('')
  const [collapsedProjectPaths, setCollapsedProjectPaths] = useState<string[]>([])

  const refreshState = useCallback(async () => {
    const result = await window.vgoDesktop?.getState?.()
    if (result) hydrate(result)
  }, [hydrate])

  const handleCreateSession = useCallback(async () => {
    try {
      const result = await window.vgoDesktop?.createSession?.()
      if (result?.state) {
        hydrate(result.state)
      } else {
        await refreshState()
      }
    } catch (e) {
      console.error('Failed to create session:', e)
    }
  }, [hydrate, refreshState])

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      try {
        const result = await window.vgoDesktop?.switchSession?.(sessionId)
        if (result?.state) {
          hydrate(result.state)
        } else if (result) {
          hydrate(result)
        } else {
          setActiveSessionId(sessionId)
        }
      } catch (e) {
        console.error('Failed to switch session:', e)
        setActiveSessionId(sessionId)
      }
    },
    [hydrate, setActiveSessionId],
  )

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        const result = await window.vgoDesktop?.deleteSession?.(sessionId)
        if (result?.state) {
          hydrate(result.state)
        } else {
          await refreshState()
        }
      } catch (e) {
        console.error('Failed to delete session:', e)
      }
    },
    [refreshState, hydrate],
  )

  const handleResetSession = useCallback(async () => {
    try {
      const result = await window.vgoDesktop?.resetSession?.()
      if (result?.state) {
        hydrate(result.state)
      } else {
        await refreshState()
      }
    } catch (e) {
      console.error('Failed to reset session:', e)
    }
  }, [hydrate, refreshState])

  const filteredSessions = useMemo(() => {
    const keyword = sessionSearch.trim().toLowerCase()
    if (!keyword) return sessions
    return sessions.filter((s) => {
      const projectPath = String(s.directory || '').toLowerCase()
      const projectName = projectPath.split(/[/\\]/).pop() || ''
      return (
        s.title.toLowerCase().includes(keyword) ||
        s.preview.toLowerCase().includes(keyword) ||
        projectPath.includes(keyword) ||
        projectName.toLowerCase().includes(keyword)
      )
    })
  }, [sessions, sessionSearch])

  const projectGroups = useMemo(() => {
    const map = new Map<string, { path: string; name: string; sessions: typeof sessions }>()
    for (const session of filteredSessions) {
      const projectPath = String(session.directory || workspace || '').trim() || '__unassigned__'
      const projectName =
        projectPath === '__unassigned__'
          ? locale === 'en-US'
            ? 'Unassigned'
            : '未绑定目录'
          : projectPath.split(/[/\\]/).pop() || projectPath

      const current = map.get(projectPath)
      if (!current) {
        map.set(projectPath, { path: projectPath, name: projectName, sessions: [session] })
        continue
      }
      current.sessions.push(session)
    }

    return [...map.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((a, b) => {
          if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        }),
      }))
      .sort((a, b) => {
        const activeInA = a.sessions.some((session) => session.id === activeSessionId)
        const activeInB = b.sessions.some((session) => session.id === activeSessionId)
        if (activeInA !== activeInB) return activeInA ? -1 : 1
        const aLatest = a.sessions[0]?.updatedAt ? new Date(a.sessions[0].updatedAt).getTime() : 0
        const bLatest = b.sessions[0]?.updatedAt ? new Date(b.sessions[0].updatedAt).getTime() : 0
        return bLatest - aLatest
      })
  }, [activeSessionId, filteredSessions, locale, workspace, sessions])

  const toggleProjectCollapsed = useCallback((projectPath: string) => {
    setCollapsedProjectPaths((prev) =>
      prev.includes(projectPath) ? prev.filter((item) => item !== projectPath) : [...prev, projectPath],
    )
  }, [])

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <section className="brand-hero">
          <div className="brand-lockup">
            <div>
              <div className="brand-title">VGO CODE</div>
              <div className="brand-subtitle">AI Agent 工作台</div>
            </div>
          </div>
          <p className="brand-copy">把登录、模型、线程、任务面板和工作区整合到一套专业化 Agent 工作流中。</p>
          <div className="brand-badges">
            <span className="brand-badge">多线程</span>
            <span className="brand-badge">多模型</span>
            <span className="brand-badge">VGO AI</span>
          </div>
        </section>

        <ModelSelector />

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">{t('sidebar.threadCenter')}</div>
              <h3>{t('sidebar.taskThreads')}</h3>
            </div>
            <button className="tiny-button" onClick={() => void handleCreateSession()}>
              <Plus size={14} />
            </button>
          </div>

          <div className="search-input-wrapper">
            <Search size={14} className="search-icon" />
            <input
              type="text"
              className="text-input"
              placeholder={t('sidebar.search')}
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
            />
          </div>

          <div className="session-list">
            {projectGroups.map((group) => {
              const collapsed = collapsedProjectPaths.includes(group.path)
              return (
                <div key={group.path} className="session-group">
                  <button className="session-group-title session-group-toggle" onClick={() => toggleProjectCollapsed(group.path)}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <FolderOpen size={12} />
                      <span>{group.name}</span>
                      <span className="active-indicator">{group.sessions.length}</span>
                    </span>
                    {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                  </button>
                  {!collapsed &&
                    group.sessions.map((session) => (
                      <SessionItem
                        key={session.id}
                        session={session}
                        isActive={session.id === activeSessionId}
                        onClick={() => void handleSwitchSession(session.id)}
                        onDelete={() => void handleDeleteSession(session.id)}
                      />
                    ))}
                </div>
              )
            })}

            {filteredSessions.length === 0 && <div className="helper-text" style={{ padding: '1rem', textAlign: 'center' }}>暂无匹配线程</div>}
          </div>

          <div className="session-actions">
            <button className="ghost-button" onClick={() => setRenameOverlayOpen(true)}>重命名当前线程</button>
            <button className="ghost-button" onClick={() => void handleResetSession()}>重置当前线程</button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <div>
              <div className="panel-kicker">{t('sidebar.workspace')}</div>
              <h3>{workspace ? t('sidebar.currentDirectory') : t('sidebar.noDirectorySelected')}</h3>
            </div>
          </div>

          <div className="workspace-path" title={workspace}>
            <FolderOpen size={14} />
            <span>{workspace ? workspace.split(/[/\\]/).pop() : t('sidebar.clickToSelectWorkspace')}</span>
          </div>

          <div className="button-stack">
            <button
              className="ghost-button"
              onClick={async () => {
                const result = await window.vgoDesktop?.pickWorkspace?.()
                if (result?.state) hydrate(result.state)
                else await refreshState()
              }}
            >
              <FolderOpen size={14} /> 切换目录
            </button>
            <button
              className="ghost-button"
              onClick={async () => {
                try {
                  await window.vgoDesktop?.analyze?.()
                  await refreshState()
                } catch (e) {
                  console.error('Error analyzing workspace:', e)
                }
              }}
            >
              <Zap size={14} /> 分析目录
            </button>
          </div>
        </section>

        <section className="sidebar-footer">
          <button className="ghost-button full-width" onClick={() => setSettingsOverlayOpen(true)}>
            <Settings size={14} /> {t('settings.label')}
          </button>
        </section>
      </div>

      <AuthPanel />
    </aside>
  )
}

interface SessionItemProps {
  session: {
    id: string
    title: string
    preview: string
    pinned: boolean
    createdAt: string
    updatedAt: string
  }
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

function SessionItem({ session, isActive, onClick, onDelete }: SessionItemProps) {
  const { t, locale } = useI18n()
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return new Intl.DateTimeFormat(locale === 'en-US' ? 'en-US' : 'zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return (
    <div className={`session-item ${isActive ? 'active' : ''}`} onClick={onClick}>
      <div className="session-item-meta">
        <button
          className={`pin-button ${session.pinned ? 'active' : ''}`}
          onClick={async (e) => {
            e.stopPropagation()
            await window.vgoDesktop?.togglePinSession?.(session.id)
            const result = await window.vgoDesktop?.getState?.()
            if (result) useAppStore.getState().hydrate(result)
          }}
        >
          <Pin size={12} />
        </button>
        <span className="session-time">{formatTime(session.updatedAt)}</span>
        <button
          className="delete-button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="session-title">{session.title || t('session.defaultTitle')}</div>
      <div className="session-preview">{session.preview || t('sidebar.noMessages')}</div>
    </div>
  )
}
