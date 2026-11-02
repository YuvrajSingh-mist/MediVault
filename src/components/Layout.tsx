import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthProvider'
import { useNow, useReminders, useUnreadCount } from '../lib/data'
import { armAlertPermission } from '../lib/alerts'
import { longDate } from '../lib/format'
import { USE_EMULATORS, PROJECT_ID } from '../lib/firebase'
import { BrandMark, Icon, type IconName } from './Icons'
import { Avatar, Badge, cx } from './ui'
import { LiveAlerts } from './LiveAlerts'

interface NavItem {
  to: string
  label: string
  icon: IconName
  end?: boolean
  badge?: number
}

export function Layout() {
  const { user, profile, activeUserId, signOutUser } = useAuth()
  const now = useNow(60_000)
  const reminders = useReminders(activeUserId)
  const unread = useUnreadCount(reminders)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  // Desktop notifications are on from the first visit; this asks once.
  useEffect(() => {
    if (!user) return
    void armAlertPermission()
  }, [user])

  const primary: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
    { to: '/medicines', label: 'Medicines', icon: 'pill' },
    { to: '/appointments', label: 'Appointments', icon: 'calendar' },
    { to: '/alerts', label: 'Alerts', icon: 'bell', badge: unread },
  ]

  const secondary: NavItem[] = [
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ]

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="MediVault home">
          <BrandMark />
          <span className="brand-text">
            <span className="brand-name">MediVault</span>
            <span className="brand-sub">Health reminders</span>
          </span>
        </Link>

        <nav className="nav" aria-label="Main navigation">
          {primary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => cx('nav-item', isActive && 'active')}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
              {item.badge ? <span className="nav-badge">{item.badge > 9 ? '9+' : item.badge}</span> : null}
            </NavLink>
          ))}

          <div className="nav-label">Account</div>
          {secondary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => cx('nav-item', isActive && 'active')}
            >
              <Icon name={item.icon} size={17} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="cloud-chip">
            <span className={cx('cloud-dot', USE_EMULATORS && 'warn')} />
            <span>{USE_EMULATORS ? 'Local emulators' : `GCP · ${PROJECT_ID}`}</span>
          </div>
          <div className="user-mini">
            <Avatar name={profile?.displayName} email={profile?.email} photoURL={profile?.photoURL} />
            <div className="meta">
              <div className="name">{profile?.displayName || 'Loading…'}</div>
              <div className="mail">{profile?.email || user?.email}</div>
            </div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-date">
            <Icon name="calendar" size={15} />
            <span>{longDate(now, profile?.timezone)}</span>
            {profile?.timezone ? <Badge tone="default">{profile.timezone}</Badge> : null}
          </div>

          <div className="topbar-actions">
            <Link to="/alerts" className="icon-btn" aria-label={`Alerts${unread ? `, ${unread} unread` : ''}`}>
              <Icon name="bell" size={18} />
              {unread > 0 ? <span className="dot" /> : null}
            </Link>

            <div className="menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="icon-btn"
                style={{ border: 0, background: 'none', padding: 0 }}
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label="Account menu"
              >
                <Avatar name={profile?.displayName} email={profile?.email} photoURL={profile?.photoURL} />
              </button>

              {menuOpen ? (
                <div className="menu" role="menu">
                  <div className="menu-head">
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                      {profile?.displayName || 'MediVault user'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {profile?.email || user?.email}
                    </div>
                  </div>
                  <Link to="/settings" className="menu-item" onClick={() => setMenuOpen(false)} role="menuitem">
                    <Icon name="user" size={16} /> Profile &amp; preferences
                  </Link>
                  <button
                    type="button"
                    className="menu-item danger"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      void signOutUser()
                    }}
                  >
                    <Icon name="logout" size={16} /> Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <Outlet />
        <LiveAlerts />
      </main>
    </div>
  )
}
