import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthProvider'
import { ToastProvider } from './context/ToastProvider'
import { Layout } from './components/Layout'
import { BrandMark, Icon } from './components/Icons'
import { Button } from './components/ui'
import { LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { MedicinesPage } from './pages/Medicines'
import { AppointmentsPage } from './pages/Appointments'
import { AlertsPage } from './pages/Alerts'
import { SettingsPage } from './pages/Settings'
import { PhoneSetupPage } from './pages/PhoneSetup'
import { SystemPage } from './pages/System'

function Splash({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'var(--bg)',
      }}
    >
      <div style={{ textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center' }}>
        <BrandMark size={46} />
        <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.02em' }}>MediVault</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--muted)', fontSize: 13 }}>
          <span className="spinner" style={{ color: 'var(--brand-600)' }} />
          {message}
        </div>
      </div>
    </div>
  )
}

function StartupError({
  message,
  onRetry,
  onSignOut,
}: {
  message: string
  onRetry: () => void
  onSignOut: () => void
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="card card-pad" style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div className="stat-icon red" style={{ flex: 'none' }}>
            <Icon name="alert" size={19} />
          </div>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 720, letterSpacing: '-0.02em' }}>
              MediVault could not reach its backend
            </h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, lineHeight: 1.6 }}>{message}</p>
            <p style={{ fontSize: 12.4, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
              If you are running locally, make sure the emulators are up:
              <br />
              <span className="mono">npm run emulators</span>
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <Button icon="refresh" onClick={onRetry}>
                Try again
              </Button>
              <Button variant="ghost" onClick={onSignOut}>
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Shell() {
  const { user, profile, loading, error, refresh, signOutUser } = useAuth()

  if (loading) return <Splash message="Connecting to Google Cloud…" />

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  if (error) {
    return <StartupError message={error} onRetry={() => void refresh()} onSignOut={() => void signOutUser()} />
  }

  // SMS is the reminder channel, so a number is required before the vault opens.
  // The profile document arrives one snapshot after auth; hold on the splash
  // until then rather than flashing the onboarding screen at returning users.
  if (!profile) return <Splash message="Loading your vault…" />

  if (!profile.phone) {
    return (
      <Routes>
        <Route path="*" element={<PhoneSetupPage />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="medicines" element={<MedicinesPage />} />
        <Route path="appointments" element={<AppointmentsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
