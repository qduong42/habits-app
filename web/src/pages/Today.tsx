// Today checklist — approved hybrid mockup, v1.1 two-section split: header +
// thin XP bar, then two tinted mega-sections — "✅ Tasks" pinned first (square
// check boxes, due chips, collapsed ⏳ Scheduled list; hidden when empty) and
// "🌱 Habits" (category sub-groups under light headers). Optimistic checks,
// floating + opening the capture sheet, ⋯ row menus. v1.2 adds the collapsed
// Done History section at the very bottom (read-only, lazily fetched).

import { useCallback, useMemo, useState } from 'react';
import { ApiError } from '../api';
import ActionSheet from '../components/ActionSheet';
import CaptureSheet from '../components/CaptureSheet';
import Celebration, { type CelebrationData } from '../components/Celebration';
import HabitForm from '../components/HabitForm';
import HabitRow from '../components/HabitRow';
import TaskForm from '../components/TaskForm';
import TaskRow from '../components/TaskRow';
import TickNote from '../components/TickNote';
import Toast from '../components/Toast';
import XpBar from '../components/XpBar';
import { formatTime } from '../format';
import {
  useArchiveHabit,
  useCheckin,
  useDeleteHabit,
  useHabits,
  useSetCheckinNote,
} from '../hooks/useHabits';
import { useHistory, useSetHistoryNote } from '../hooks/useHistory';
import { setWith, useNoteChips } from '../hooks/useNoteChips';
import { useCompleteTask, useDeleteTask, useSetCompletionNote, useTasks } from '../hooks/useTasks';
import type { Category, Habit, HistoryEntry, TaskItem } from '../types';

/** XP chip anchored to the tapped habit/task row; `key` re-mounts on re-tap. */
interface XpToast {
  rowId: string;
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

/** History date label: "2026-06-10" → "Jun 10" (plain local-date parse, no TZ
 * shift — the server's localDate is already user-TZ); adds the year when older. */
function formatHistoryDate(localDate: string, now: Date = new Date()): string {
  const [y, m, d] = localDate.split('-').map(Number);
  if (!y || !m || !d) return localDate;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(y === now.getFullYear() ? {} : { year: 'numeric' }),
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
  const tasksQuery = useTasks();
  const checkin = useCheckin();
  const setCheckinNote = useSetCheckinNote();
  const archiveHabit = useArchiveHabit();
  const deleteHabit = useDeleteHabit();
  const completeTask = useCompleteTask();
  const setCompletionNote = useSetCompletionNote();
  const deleteTask = useDeleteTask();

  const [formOpen, setFormOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [menuHabit, setMenuHabit] = useState<Habit | null>(null);
  const [editTask, setEditTask] = useState<TaskItem | null>(null);
  const [menuTask, setMenuTask] = useState<TaskItem | null>(null);
  const [scheduledOpen, setScheduledOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<XpToast | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  // Done History: section toggle + per-date expansion, same interaction as the
  // Dump History. historyRequested latches true on first expansion and never
  // resets — it fires the lazy GET /history query once.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRequested, setHistoryRequested] = useState(false);
  const [openHistoryDates, setOpenHistoryDates] = useState<ReadonlySet<string>>(new Set());
  // Per-entry expansion: the note (and its editor) only show when an
  // activity row is tapped open.
  const [openHistoryEntries, setOpenHistoryEntries] = useState<ReadonlySet<string>>(new Set());
  const setHistoryNote = useSetHistoryNote();
  // Today rows: collapsed note chips, 30s auto-expand on tick, sticky manual
  // toggles — the state machine lives in useNoteChips.
  const noteChips = useNoteChips();
  const history = useHistory(historyRequested);

  // Entries grouped by the server's localDate (user-TZ correct — NOT
  // browser-local createdAt). Entries arrive createdAt desc, so each group is
  // newest-first; the explicit key sort keeps the date rows newest-first even
  // if localDate ever disagrees with createdAt order around midnight.
  const historyGroups = useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of history.data ?? []) {
      const group = groups.get(entry.localDate);
      if (group) group.push(entry);
      else groups.set(entry.localDate, [entry]);
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [history.data]);

  // Stable callbacks so Toast/Celebration effects don't restart every render.
  const clearToast = useCallback(() => setToast(null), []);
  const closeCelebration = useCallback(() => setCelebration(null), []);

  // Shared rewards feedback for habit check-ins AND task completions: XP chip
  // near the tapped row, celebration on level-up / achievement unlock.
  // GameContext (XpBar) is fed by the hooks; undo responses get no feedback.
  function showRewards(
    rowId: string,
    res: {
      xpGained: number;
      level: number;
      leveledUp: boolean;
      unlockedAchievements: CelebrationData['unlockedAchievements'];
    },
  ) {
    setToast({ rowId, text: `+${res.xpGained} XP`, key: Date.now() });
    if (res.leveledUp || res.unlockedAchievements.length > 0) {
      setCelebration({
        level: res.leveledUp ? res.level : null,
        unlockedAchievements: res.unlockedAchievements,
      });
    }
  }

  // already_done is success-ish: the row IS checked server-side.
  function showToggleError(err: Error) {
    if (err instanceof ApiError && err.code === 'already_done') return;
    setActionError(err.message);
  }

  function handleToggle(habit: Habit, done: boolean) {
    setActionError(null);
    noteChips.autoExpand(habit.id, done);
    checkin.mutate(
      { habitId: habit.id, done },
      {
        onSuccess: (res) => {
          if ('xpGained' in res) showRewards(habit.id, res);
        },
        onError: showToggleError,
      },
    );
  }

  function handleTaskToggle(task: TaskItem, done: boolean) {
    setActionError(null);
    noteChips.autoExpand(task.id, done);
    completeTask.mutate(
      { task, done },
      {
        onSuccess: (res) => {
          if ('xpGained' in res) showRewards(task.id, res);
        },
        onError: showToggleError,
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

  function handleTaskDelete(task: TaskItem) {
    setMenuTask(null);
    if (!window.confirm(`Delete "${task.name}"? This cannot be undone.`)) return;
    setActionError(null);
    deleteTask.mutate(task.id, { onError: (err) => setActionError(err.message) });
  }

  function toggleHistory() {
    setHistoryOpen((open) => !open);
    setHistoryRequested(true); // latch — fires the lazy /history query once
  }

  function toggleHistoryEntry(id: string) {
    setOpenHistoryEntries((prev) => setWith(prev, id, !prev.has(id)));
  }

  function toggleHistoryDate(key: string) {
    setOpenHistoryDates((dates) => setWith(dates, key, !dates.has(key)));
  }

  if (isPending) return <p className="placeholder">Loading…</p>;
  if (error) return <p className="form-error">Could not load habits: {error.message}</p>;
  if (!data) return null;

  const groups = groupByCategory(data.habits);

  // 📌 Tasks: server orders overdue → today → undated → done → scheduled; the
  // client re-partitions so optimistic group flips move rows immediately.
  const allTasks = tasksQuery.data?.tasks ?? [];
  const scheduledTasks = allTasks.filter((t) => t.group === 'scheduled');
  const visibleTasks = allTasks.filter((t) => t.group !== 'scheduled');
  const doneTasks = visibleTasks.filter((t) => t.group === 'done');
  const openTasks = visibleTasks.filter((t) => t.group !== 'done');

  const taskRow = (task: TaskItem) => (
    <div key={task.id} className="habit-row-wrap">
      <TaskRow
        task={task}
        onToggle={handleTaskToggle}
        onMenu={setMenuTask}
        onNote={(t, note) => setCompletionNote.mutate({ taskId: t.id, note })}
        noteOpen={noteChips.isOpen(task.id)}
        onNoteToggle={() => noteChips.toggle(task.id)}
        onNoteInteract={() => noteChips.cancelTimer(task.id)}
      />
      {toast?.rowId === task.id && <Toast key={toast.key} text={toast.text} onDone={clearToast} />}
    </div>
  );

  return (
    <div className="today-page">
      <div className="today-header">
        <h1 className="page-title today-title">Today</h1>
        <span className="today-date">{formatToday(data.today)}</span>
      </div>

      <XpBar />

      {actionError && <p className="form-error">{actionError}</p>}
      {tasksQuery.error && (
        <p className="form-error">Could not load tasks: {tasksQuery.error.message}</p>
      )}

      {allTasks.length > 0 && (
        <section className="mega-section mega-tasks">
          <div className="mega-header">
            <span className="mega-title">✅ Tasks</span>
            {/* Only scheduled tasks → "0/0" reads broken; the count ignores
                not-yet-due tasks, so hide it until something is actionable. */}
            {visibleTasks.length > 0 && (
              <span className="mega-count">
                {doneTasks.length}/{visibleTasks.length}
              </span>
            )}
          </div>
          {openTasks.map(taskRow)}
          {doneTasks.map(taskRow)}
          {scheduledTasks.length > 0 && (
            <>
              <button
                type="button"
                className="scheduled-toggle"
                aria-expanded={scheduledOpen}
                onClick={() => setScheduledOpen((open) => !open)}
              >
                {scheduledOpen ? '▾' : '▸'} ⏳ Scheduled {scheduledTasks.length}
              </button>
              {scheduledOpen && scheduledTasks.map(taskRow)}
            </>
          )}
        </section>
      )}

      {data.habits.length === 0 ? (
        <div className="empty-state">
          <p>No habits yet — every streak starts with one.</p>
          <p className="empty-arrow">Tap the + button to add your first habit ↘</p>
        </div>
      ) : (
        <section className="mega-section mega-habits">
          <div className="mega-header">
            <span className="mega-title">🌱 Habits</span>
            <span className="mega-count">
              {data.habits.filter((h) => h.doneToday).length}/
              {data.habits.filter((h) => h.scheduledToday).length}
            </span>
          </div>
          {groups.map(({ category, habits }) => {
            const done = habits.filter((h) => h.doneToday).length;
            const scheduled = habits.filter((h) => h.scheduledToday).length;
            return (
              <div key={category.id} className="cat-group">
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
                    <HabitRow
                      habit={habit}
                      onToggle={handleToggle}
                      onMenu={setMenuHabit}
                      onNote={(h, note) => setCheckinNote.mutate({ habitId: h.id, note })}
                      noteOpen={noteChips.isOpen(habit.id)}
                      onNoteToggle={() => noteChips.toggle(habit.id)}
                      onNoteInteract={() => noteChips.cancelTimer(habit.id)}
                    />
                    {toast?.rowId === habit.id && (
                      <Toast key={toast.key} text={toast.text} onDone={clearToast} />
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </section>
      )}

      <section className="done-history">
        <button
          type="button"
          className="done-history-toggle"
          aria-expanded={historyOpen}
          onClick={toggleHistory}
        >
          History
        </button>
        {historyOpen &&
          (history.isPending ? (
            <p className="placeholder">Loading…</p>
          ) : history.error ? (
            <p className="form-error">Could not load history: {history.error.message}</p>
          ) : historyGroups.length === 0 ? (
            <p className="placeholder">Nothing completed yet</p>
          ) : (
            <ul className="done-history-dates">
              {historyGroups.map(([key, group]) => (
                <li key={key} className="done-history-date">
                  <button
                    type="button"
                    className="done-history-date-toggle"
                    aria-expanded={openHistoryDates.has(key)}
                    onClick={() => toggleHistoryDate(key)}
                  >
                    {formatHistoryDate(key)} · {group.length} done
                  </button>
                  {openHistoryDates.has(key) && (
                    <ul className="done-history-items">
                      {group.map((entry) => (
                        <li key={entry.id} className="done-history-item">
                          <button
                            type="button"
                            className="done-history-entry-toggle"
                            aria-expanded={openHistoryEntries.has(entry.id)}
                            onClick={() => toggleHistoryEntry(entry.id)}
                          >
                            {entry.kind === 'checkin' ? '✅' : '📦'} {entry.name}
                            <span className="done-history-time">
                              {' '}
                              · {formatTime(entry.createdAt)}
                            </span>
                          </button>
                          {openHistoryEntries.has(entry.id) && (
                            <div className="done-history-note">
                              <TickNote
                                note={entry.note}
                                onSave={(note) => setHistoryNote.mutate({ entryId: entry.id, note })}
                              />
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>

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
          onNewTask={() => {
            setEditTask(null);
            setTaskFormOpen(true);
          }}
        />
      )}

      {formOpen && (
        <HabitForm habit={editHabit ?? undefined} onClose={() => setFormOpen(false)} />
      )}

      {taskFormOpen && (
        <TaskForm task={editTask ?? undefined} onClose={() => setTaskFormOpen(false)} />
      )}

      {celebration && (
        <Celebration
          level={celebration.level}
          unlockedAchievements={celebration.unlockedAchievements}
          onClose={closeCelebration}
        />
      )}

      {menuHabit && (
        <ActionSheet
          title={menuHabit.name}
          onClose={() => setMenuHabit(null)}
          actions={[
            {
              label: '✏️ Edit',
              onClick: () => {
                setEditHabit(menuHabit);
                setMenuHabit(null);
                setFormOpen(true);
              },
            },
            { label: '📦 Archive', onClick: () => handleArchive(menuHabit) },
            { label: '🗑 Delete', onClick: () => handleDelete(menuHabit), danger: true },
          ]}
        />
      )}

      {menuTask && (
        <ActionSheet
          title={menuTask.name}
          onClose={() => setMenuTask(null)}
          actions={[
            {
              label: '✏️ Edit',
              onClick: () => {
                setEditTask(menuTask);
                setMenuTask(null);
                setTaskFormOpen(true);
              },
            },
            { label: '🗑 Delete', onClick: () => handleTaskDelete(menuTask), danger: true },
          ]}
        />
      )}
    </div>
  );
}
