// Today checklist — approved hybrid mockup: header + thin XP bar, habits
// grouped under light category headers, optimistic check circles, floating +
// button opening the HabitForm bottom sheet, ⋯ row menu (edit/archive/delete).

import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api';
import CaptureSheet from '../components/CaptureSheet';
import Celebration, { type CelebrationData } from '../components/Celebration';
import HabitForm from '../components/HabitForm';
import HabitRow from '../components/HabitRow';
import Toast from '../components/Toast';
import XpBar from '../components/XpBar';
import {
  useArchiveHabit,
  useCheckin,
  useDeleteHabit,
  useHabits,
} from '../hooks/useHabits';
import type { Category, Habit } from '../types';

/** XP chip anchored to the tapped row; `key` re-mounts it on rapid re-taps. */
interface XpToast {
  habitId: string;
  text: string;
  key: number;
}

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

  const [formOpen, setFormOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [menuHabit, setMenuHabit] = useState<Habit | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<XpToast | null>(null);
  const [capturedToast, setCapturedToast] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);

  // Stable callbacks so Toast/Celebration effects don't restart every render.
  const clearToast = useCallback(() => setToast(null), []);
  const closeCelebration = useCallback(() => setCelebration(null), []);

  // "Captured 💡" page toast — auto-clears; you stay on Today.
  useEffect(() => {
    if (!capturedToast) return;
    const timer = setTimeout(() => setCapturedToast(false), 1800);
    return () => clearTimeout(timer);
  }, [capturedToast]);

  function handleToggle(habit: Habit, done: boolean) {
    setActionError(null);
    checkin.mutate(
      { habitId: habit.id, done },
      {
        onSuccess: (res) => {
          // GameContext (XpBar) is fed by the hook; this handles the rest of
          // the feedback. Undo responses ('xpLost') get no toast/celebration.
          if (!('xpGained' in res)) return;
          setToast({ habitId: habit.id, text: `+${res.xpGained} XP`, key: Date.now() });
          if (res.leveledUp || res.unlockedAchievements.length > 0) {
            setCelebration({
              level: res.leveledUp ? res.level : null,
              unlockedAchievements: res.unlockedAchievements,
            });
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

      <XpBar />

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
                <div key={habit.id} className="habit-row-wrap">
                  <HabitRow habit={habit} onToggle={handleToggle} onMenu={setMenuHabit} />
                  {toast?.habitId === habit.id && (
                    <Toast key={toast.key} text={toast.text} onDone={clearToast} />
                  )}
                </div>
              ))}
            </section>
          );
        })
      )}

      <button
        type="button"
        className="fab"
        aria-label="Add a thought or habit"
        onClick={() => setCaptureOpen(true)}
      >
        +
      </button>

      {captureOpen && (
        <CaptureSheet
          onClose={() => setCaptureOpen(false)}
          onNewHabit={() => {
            setEditHabit(null);
            setFormOpen(true);
          }}
          onCaptured={() => setCapturedToast(true)}
        />
      )}

      {capturedToast && (
        <div className="captured-toast" role="status">
          Captured 💡
        </div>
      )}

      {formOpen && (
        <HabitForm habit={editHabit ?? undefined} onClose={() => setFormOpen(false)} />
      )}

      {celebration && (
        <Celebration
          level={celebration.level}
          unlockedAchievements={celebration.unlockedAchievements}
          onClose={closeCelebration}
        />
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
