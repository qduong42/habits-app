import { NavLink, Outlet } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Today', emoji: '✅', end: true },
  { to: '/dump', label: 'Dump', emoji: '🧠', end: false },
  { to: '/stats', label: 'Stats', emoji: '📊', end: false },
  { to: '/profile', label: 'Profile', emoji: '👤', end: false },
];

export default function Layout() {
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
            </span>
            <span className="tab-label">{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
