import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useGame } from './hooks/useGame';
import { useInbox } from './hooks/useInbox';
import { useStats } from './hooks/useStats';

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

  // Seed GameContext from /stats so the XP bar shows the real level after a
  // reload instead of the Lv 1 default (Task 14 review note). Layout only
  // renders authed (inside RequireAuth), so the query can't 401-bounce the
  // login page. No loop risk: applyXp is identity-stable and the effect only
  // re-runs when the query yields a new data object (initial load/refetch),
  // never when applyXp itself updates the context.
  const stats = useStats();
  const { applyXp } = useGame();
  const statsData = stats.data;
  useEffect(() => {
    if (statsData) applyXp({ xpTotal: statsData.xpTotal, level: statsData.level });
  }, [statsData, applyXp]);

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
