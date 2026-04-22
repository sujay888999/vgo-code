import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles/global.css'

type GuardedAppState = {
  hasError: boolean
  message: string
}

class GuardedApp extends React.Component<Record<string, never>, GuardedAppState> {
  state: GuardedAppState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: unknown): GuardedAppState {
    const message = error instanceof Error ? error.stack || error.message : String(error || 'unknown error')
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.stack || error.message : String(error || 'unknown error')
    window.vgoDesktop?.reportRendererError?.({
      source: 'react_error_boundary',
      message,
    })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f8fafc',
            color: '#111827',
            padding: 24,
            fontFamily: 'Segoe UI, PingFang SC, Microsoft YaHei, sans-serif',
          }}
        >
          <div style={{ maxWidth: 760, width: '100%', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 18 }}>
            <h2 style={{ margin: '0 0 10px 0', fontSize: 20 }}>界面加载失败（已拦截白屏）</h2>
            <p style={{ margin: '0 0 10px 0', color: '#4b5563' }}>
              请重启应用。如果仍复现，把下方错误内容发给我，我会继续定位。
            </p>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 8,
                background: '#f3f4f6',
                border: '1px solid #e5e7eb',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: 12,
              }}
            >
              {this.state.message || 'no details'}
            </pre>
          </div>
        </div>
      )
    }

    return <App />
  }
}

window.addEventListener('error', (event) => {
  window.vgoDesktop?.reportRendererError?.({
    source: 'window_error',
    message: event?.error?.stack || event?.message || 'window error',
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason
  const message = reason instanceof Error ? reason.stack || reason.message : String(reason || 'unhandled rejection')
  window.vgoDesktop?.reportRendererError?.({
    source: 'unhandled_rejection',
    message,
  })
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GuardedApp />
  </React.StrictMode>
)
