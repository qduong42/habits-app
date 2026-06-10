import { NavLink, Outlet } from 'react-router-dom';
import { useInbox } from './hooks/useInbox';

const tabs = [
  { to: '/', label: 'Today', emoji: '✅', end: true },
  { to: '/dump', label: 'Dump', emoji: '🧠', end: false },
  { to: '/stats', label: 'Stats', emoji: '📊', end: false },
  { to: '/profile', label: 'Profile', emoji: '👤', end: false },
];

export default function Layout() {
  // Open dump-item count for the Dump tab badge — shares the ['inbox'] cache
  // with the Dump page, so captures/converts/discards update it instantly.
  const inbox = useInbox();
  const openCount = inbox.data?.length ?? 0;

  return (
    <div className="app-shell">
      <main className="content">
        <Outlet />
      </main>
      <nav className="tab-bar">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => 'tab' + (isActive ? ' tab-active' : '')}
          >
            <span className="tab-emoji" aria-hidden="true">
              {tab.emoji}
              {tab.to === '/dump' && openCount > 0 && (
                <span className="tab-badge" aria-hidden="true">
                  {openCount > 99 ? '99+' : openCount}
                </span>
              )}
            </span>
            <span className="tab-label">
              {tab.label}
              {tab.to === '/dump' && openCount > 0 && (
                <span className="visually-hidden">, {openCount} open items</span>
              )}
            </span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
