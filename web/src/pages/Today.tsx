// Today checklist — approved hybrid mockup: header + thin XP bar, habits
// grouped under light category headers, optimistic check circles, floating +
// button opening the HabitForm bottom sheet, ⋯ row menu (edit/archive/delete).

import { useState } from 'react';
import { ApiError } from '../api';
import HabitForm from '../components/HabitForm';
import HabitRow from '../components/HabitRow';
import XpBar from '../components/XpBar';
import {
  useArchiveHabit,
  useCheckin,
  useDeleteHabit,
  useHabits,
} from '../hooks/useHabits';
import type { Category, Habit } from '../types';

interface XpState {
  level: number;
  into: number;
  needed: number;
}

// Session-level stopgap until Tasks 13/17 wire real XP: remember the last
// check-in response across mounts. Task 14 replaces this with GameContext.
let lastXp: XpState = { level: 1, into: 0, needed: 1000 };

/** "2026-06-10" → "Wed, Jun 10" (parsed as plain local date, no TZ shift). */
function formatToday(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

interface CategoryGroup {
  category: Category;
  habits: Habit[];
}

/** Group habits by category, preserving the server's habit order. */
function groupByCategory(habits: Habit[]): CategoryGroup[] {
  const groups = new Map<string, CategoryGroup>();
  for (const habit of habits) {
    let group = groups.get(habit.category.id);
    if (!group) {
      group = { category: habit.category, habits: [] };
      groups.set(habit.category.id, group);
    }
    group.habits.push(habit);
  }
  return [...groups.values()];
}

export default function Today() {
  const { data, isPending, error } = useHabits();
  const checkin = useCheckin();
  const archiveHabit = useArchiveHabit();
  const deleteHabit = useDeleteHabit();

  const [xp, setXp] = useState<XpState>(lastXp);
  const [formOpen, setFormOpen] = useState(false);
  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [menuHabit, setMenuHabit] = useState<Habit | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function handleToggle(habit: Habit, done: boolean) {
    setActionError(null);
    checkin.mutate(
      { habitId: habit.id, done },
      {
        onSuccess: (res) => {
          if (res) {
            lastXp = { level: res.level, into: res.xpTotal % 1000, needed: 1000 };
            setXp(lastXp);
          }
        },
        onError: (err) => {
          // already_done is success-ish: the habit is checked server-side.
          if (err instanceof ApiError && err.code === 'already_done') return;
          setActionError(err.message);
        },
      },
    );
  }

  function handleArchive(habit: Habit) {
    setMenuHabit(null);
    if (!window.confirm(`Archive "${habit.name}"? It keeps its history and disappears from Today.`))
      return;
    setActionError(null);
    archiveHabit.mutate(habit.id, { onError: (err) => setActionError(err.message) });
  }

  function handleDelete(habit: Habit) {
    setMenuHabit(null);
    if (!window.confirm(`Delete "${habit.name}" and all its check-ins? This cannot be undone.`))
      return;
    setActionError(null);
    deleteHabit.mutate(habit.id, { onError: (err) => setActionError(err.message) });
  }

  if (isPending) return <p className="placeholder">Loading…</p>;
  if (error) return <p className="form-error">Could not load habits: {error.message}</p>;
  if (!data) return null;

  const groups = groupByCategory(data.habits);

  return (
    <div className="today-page">
      <div className="today-header">
        <h1 className="page-title today-title">Today</h1>
        <span className="today-date">{formatToday(data.today)}</span>
      </div>

      <XpBar level={xp.level} into={xp.into} needed={xp.needed} />

      {actionError && <p className="form-error">{actionError}</p>}

      {data.habits.length === 0 ? (
        <div className="empty-state">
          <p>No habits yet — every streak starts with one.</p>
          <p className="empty-arrow">Tap the + button to add your first habit ↘</p>
        </div>
      ) : (
        groups.map(({ category, habits }) => {
          const done = habits.filter((h) => h.doneToday).length;
          const scheduled = habits.filter((h) => h.scheduledToday).length;
          return (
            <section key={category.id} className="cat-group">
              <div className="cat-header">
                <span className="cat-name" style={{ color: category.color }}>
                  {category.emoji} {category.name}
                </span>
                <span className="cat-count">
                  {done}/{scheduled}
                </span>
              </div>
              {habits.map((habit) => (
                <HabitRow
                  key={habit.id}
                  habit={habit}
                  onToggle={handleToggle}
                  onMenu={setMenuHabit}
                />
              ))}
            </section>
          );
        })
      )}

      <button
        type="button"
        className="fab"
        aria-label="New habit"
        onClick={() => {
          setEditHabit(null);
          setFormOpen(true);
        }}
      >
        +
      </button>

      {formOpen && (
        <HabitForm habit={editHabit ?? undefined} onClose={() => setFormOpen(false)} />
      )}

      {menuHabit && (
        <div className="sheet-scrim" onClick={() => setMenuHabit(null)}>
          <div
            className="sheet action-sheet"
            role="dialog"
            aria-label={`Options for ${menuHabit.name}`}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="sheet-title">{menuHabit.name}</h2>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                setEditHabit(menuHabit);
                setMenuHabit(null);
                setFormOpen(true);
              }}
            >
              ✏️ Edit
            </button>
            <button type="button" className="action-btn" onClick={() => handleArchive(menuHabit)}>
              📦 Archive
            </button>
            <button
              type="button"
              className="action-btn action-btn-danger"
              onClick={() => handleDelete(menuHabit)}
            >
              🗑 Delete
            </button>
            <button type="button" className="action-btn" onClick={() => setMenuHabit(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
