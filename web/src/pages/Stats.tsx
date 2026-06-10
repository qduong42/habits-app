// Stats tab (Task 18) — overall cards (day streak, total check-ins, level +
// XP progress) and a per-habit list with current/best streaks and a thin
// 28-day completion bar. Data comes from the shared ['stats'] query; Layout
// seeds GameContext from the same cache, so the XpBar styles reused here
// always agree with the tab-wide bar.

import { useStats } from '../hooks/useStats';
import { XP_PER_LEVEL } from '../hooks/useGame';
import type { StatsHabit } from '../types';

function HabitStatsRow({ habit }: { habit: StatsHabit }) {
  return (
    <div className="stats-habit">
      <div className="stats-habit-top">
        <span className="stats-habit-name">
          <span aria-hidden="true">{habit.emoji}</span> {habit.name}
        </span>
        <span className="stats-habit-streaks">
          current {habit.streak} · best {habit.bestStreak}
        </span>
      </div>
      <div
        className="stats-28-track"
        role="progressbar"
        aria-label={`${habit.name}: ${habit.last28}% completion in the last 28 days`}
        aria-valuenow={habit.last28}
        aria-valuemax={100}
      >
        <div className="stats-28-fill" style={{ width: `${habit.last28}%` }} />
      </div>
    </div>
  );
}

export default function Stats() {
  const stats = useStats();

  return (
    <div>
      <h1 className="page-title">Stats</h1>

      {stats.isPending && <p className="placeholder">Loading…</p>}
      {stats.error && <p className="form-error">Could not load stats: {stats.error.message}</p>}

      {stats.data && (
        <>
          <div className="stats-cards">
            <div className="stat-card">
              <span className="stat-emoji" aria-hidden="true">
                🔥
              </span>
              <span className="stat-value">{stats.data.dayStreak}</span>
              <span className="stat-label">day streak</span>
            </div>
            <div className="stat-card">
              <span className="stat-emoji" aria-hidden="true">
                ✅
              </span>
              <span className="stat-value">{stats.data.totalCheckins}</span>
              <span className="stat-label">check-ins</span>
            </div>
            <div className="stat-card">
              <span className="stat-value">Lv {stats.data.level}</span>
              {/* same track/fill styles as the global XpBar */}
              <div
                className="xp-track stat-level-track"
                role="progressbar"
                aria-label="XP into current level"
                aria-valuenow={stats.data.xpTotal % XP_PER_LEVEL}
                aria-valuemax={XP_PER_LEVEL}
              >
                <div
                  className="xp-fill"
                  style={{ width: `${((stats.data.xpTotal % XP_PER_LEVEL) / XP_PER_LEVEL) * 100}%` }}
                />
              </div>
              <span className="stat-label">
                {stats.data.xpTotal % XP_PER_LEVEL} / {XP_PER_LEVEL} XP
              </span>
            </div>
          </div>

          <h2 className="section-title">Habits · last 28 days</h2>
          {stats.data.habits.length === 0 ? (
            <p className="placeholder">
              No habits yet — create one on the Today tab and your streaks will show up here.
            </p>
          ) : (
            stats.data.habits.map((h) => <HabitStatsRow key={h.id} habit={h} />)
          )}
        </>
      )}
    </div>
  );
}
