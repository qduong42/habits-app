// One task row in the 📌 Tasks section: SQUARE check box (vs the round habit
// circle), name, recurring 🔁 interval hint or pending-reminder 🔔 badge
// (one-off only — the two never co-occur), right-aligned due chip (red when
// overdue, orange when due today), ⋯ menu. Done rows render struck through;
// tapping the checked square undoes (same-day only, server-enforced).
// Scheduled rows (collapsed "⏳ Scheduled" list) have no check box — they are
// not actionable yet, only editable.

import { formatDumpDate } from '../format';
import type { TaskGroup, TaskItem } from '../types';
import NameToggle from './NameToggle';
import TickNote from './TickNote';

/** "every 12h" / "every 5d" — whole days collapse to the day form. */
function intervalHint(intervalHours: number): string {
  return intervalHours % 24 === 0
    ? `every ${intervalHours / 24}d`
    : `every ${intervalHours}h`;
}

const DUE_CHIP_CLASS: Partial<Record<TaskGroup, string>> = {
  overdue: 'due-chip due-chip-overdue',
  today: 'due-chip due-chip-today',
  scheduled: 'due-chip due-chip-scheduled',
};

interface TaskRowProps {
  task: TaskItem;
  onToggle: (task: TaskItem, done: boolean) => void;
  onMenu: (task: TaskItem) => void;
  onNote: (task: TaskItem, note: string) => void;
  /** Note chip expanded? Collapsed rows show just the name (tap it to expand). */
  noteOpen: boolean;
  onNoteToggle: () => void;
  onNoteInteract: () => void;
}

export default function TaskRow({
  task,
  onToggle,
  onMenu,
  onNote,
  noteOpen,
  onNoteToggle,
  onNoteInteract,
}: TaskRowProps) {
  const done = task.group === 'done';
  const scheduled = task.group === 'scheduled';

  return (
    <div className={'habit-row' + (done ? ' habit-row-done' : '')}>
      {scheduled ? (
        <span className="check-square check-square-scheduled" aria-hidden="true">
          ⏳
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          className={'check-square' + (done ? ' check-square-done' : '')}
          aria-label={done ? `Undo ${task.name}` : `Complete ${task.name}`}
          onClick={() => onToggle(task, !done)}
        >
          {done ? '✓' : ''}
        </button>
      )}
      <div className="habit-main">
        <NameToggle name={task.name} done={done} noteOpen={noteOpen} onToggle={onNoteToggle} />
        {done && noteOpen && (
          <TickNote
            note={task.todayNote}
            onSave={(n) => onNote(task, n)}
            onEditStart={onNoteInteract}
          />
        )}
        {task.kind === 'recurring' && task.intervalHours !== null && (
          <div className="task-interval">🔁 {intervalHint(task.intervalHours)}</div>
        )}
        {task.remindAt !== null &&
          task.remindedAt === null &&
          new Date(task.remindAt).getTime() > Date.now() && (
            <div className="task-interval">🔔 {formatDumpDate(task.remindAt)}</div>
          )}
      </div>
      {task.dueLabel !== null && (
        <span className={DUE_CHIP_CLASS[task.group] ?? 'due-chip'}>{task.dueLabel}</span>
      )}
      <button
        type="button"
        className="row-menu-btn"
        aria-label={`Options for ${task.name}`}
        onClick={() => onMenu(task)}
      >
        ⋯
      </button>
    </div>
  );
}
