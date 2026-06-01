import { useCallback, useState } from 'react'
import { useAppStore } from '../store/appStore'
import { useI18n } from '../i18n'
import {
  LogIn, LogOut, User,
} from 'lucide-react'

export function AuthPanel() {
  const { t } = useI18n()
  const {
    vgoAILoggedIn, vgoAIDisplayName, vgoAIEmail, vgoAIPreferredModel, hydrate,
  } = useAppStore()

  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [loginEmail, setLoginEmail] = useState(vgoAIEmail || '')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginDisplayName, setLoginDisplayName] = useState(vgoAIDisplayName || 'VGO AI Developer')
  const [loginStatus, setLoginStatus] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const refreshState = useCallback(async () => {
    const result = await window.vgoDesktop?.getState?.()
    if (result) hydrate(result)
  }, [hydrate])

  const handleBrowserLogin = useCallback(async () => {
    setIsLoggingIn(true)
    setLoginStatus(t('status.openingLoginPage'))
    try {
      await window.vgoDesktop?.login?.()
      setLoginStatus(t('status.loginPageOpened'))
    } catch (e: unknown) {
      setLoginStatus(e instanceof Error ? e.message : t('status.loginFailed'))
    } finally {
      setIsLoggingIn(false)
    }
  }, [t])

  const handlePasswordLogin = useCallback(async () => {
    if (!loginEmail.trim() || !loginPassword.trim()) {
      setLoginStatus(t('status.enterEmailPassword'))
      return
    }
    setIsLoggingIn(true)
    setLoginStatus(t('status.loggingIn'))
    try {
      await window.vgoDesktop?.loginWithCredentials?.({
        email: loginEmail.trim(),
        password: loginPassword,
        displayName: loginDisplayName.trim() || 'VGO AI Developer',
        preferredModel: vgoAIPreferredModel || 'vgo-coder-pro',
      })
      await refreshState()
      setLoginPassword('')
      setLoginStatus(t('status.loginSuccess'))
      setShowPasswordForm(false)
    } catch (e: unknown) {
      setLoginStatus(e instanceof Error ? e.message : t('status.loginError'))
    } finally {
      setIsLoggingIn(false)
    }
  }, [t, loginEmail, loginPassword, loginDisplayName, vgoAIPreferredModel, refreshState])

  const handleLogout = useCallback(async () => {
    try {
      await window.vgoDesktop?.logout?.()
      await refreshState()
      setLoginStatus(t('status.loggedOut'))
    } catch (e: unknown) {
      setLoginStatus(e instanceof Error ? e.message : t('status.logoutError'))
    }
  }, [t, refreshState])

  return (
    <section className="sidebar-footer">
      <div className="sidebar-auth-box">
        <div className="sidebar-auth-head">
          <span className="panel-kicker">{t('sidebar.loginEntry')}</span>
          <div className={`status-pill ${vgoAILoggedIn ? 'online' : ''}`}>
            {vgoAILoggedIn ? t('sidebar.loggedIn') : t('sidebar.notLoggedIn')}
          </div>
        </div>

        {vgoAILoggedIn ? (
          <div className="sidebar-auth-summary">
            <div className="helper-text">{vgoAIDisplayName || vgoAIEmail || t('sidebar.accountLoggedIn')}</div>
            <button className="ghost-button full-width" onClick={() => void handleLogout()}>
              <LogOut size={14} /> {t('sidebar.logout')}
            </button>
          </div>
        ) : (
          <>
            <button className="primary-button full-width" onClick={() => void handleBrowserLogin()} disabled={isLoggingIn}>
              <LogIn size={14} /> {t('sidebar.browserLogin')}
            </button>
            <button className="ghost-button full-width" onClick={() => setShowPasswordForm((v) => !v)}>
              <User size={14} /> {t('sidebar.emailLogin')}
            </button>

            {showPasswordForm && (
              <div className="sidebar-login-form">
                <input className="text-input" placeholder={t('sidebar.emailAddress')}
                  value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
                <input className="text-input" type="password" placeholder={t('sidebar.password')}
                  value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handlePasswordLogin()} />
                <input className="text-input" placeholder={t('sidebar.displayName')}
                  value={loginDisplayName} onChange={(e) => setLoginDisplayName(e.target.value)} />
                <button className="primary-button full-width" onClick={() => void handlePasswordLogin()} disabled={isLoggingIn}>
                  <LogIn size={14} /> {isLoggingIn ? t('sidebar.loggingIn') : t('sidebar.confirmLogin')}
                </button>
              </div>
            )}

            {loginStatus && <div className="login-status">{loginStatus}</div>}
          </>
        )}
      </div>
    </section>
  )
}
