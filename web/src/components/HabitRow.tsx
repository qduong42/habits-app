// One habit row: round check circle, name, weekly progress line, streak
// flame, ⋯ menu. Weekly habits whose target is met but weren't done today
// render in the done style but stay clickable — over-completion is allowed
// (count shows e.g. 2/1; the server never capped this, only same-day dups).

import type { Habit } from '../types';
import NameToggle from './NameToggle';
import TickNote from './TickNote';

interface HabitRowProps {
  habit: Habit;
  onToggle: (habit: Habit, done: boolean) => void;
  onMenu: (habit: Habit) => void;
  onNote: (habit: Habit, note: string) => void;
  /** Note chip expanded? Collapsed rows show just the name (tap it to expand). */
  noteOpen: boolean;
  onNoteToggle: () => void;
  onNoteInteract: () => void;
}

export default function HabitRow({
  habit,
  onToggle,
  onMenu,
  onNote,
  noteOpen,
  onNoteToggle,
  onNoteInteract,
}: HabitRowProps) {
  const weeklyMet =
    habit.frequencyType === 'weekly' &&
    habit.weeklyTarget !== null &&
    habit.weekCount >= habit.weeklyTarget;
  const doneStyle = habit.doneToday || weeklyMet;

  return (
    <div className={'habit-row' + (doneStyle ? ' habit-row-done' : '')}>
      <button
        type="button"
        role="checkbox"
        aria-checked={habit.doneToday}
        className={'check-circle' + (habit.doneToday ? ' check-circle-done' : '')}
        aria-label={habit.doneToday ? `Uncheck ${habit.name}` : `Check off ${habit.name}`}
        onClick={() => onToggle(habit, !habit.doneToday)}
      >
        {habit.doneToday ? '✓' : ''}
      </button>
      <div className="habit-main">
        <NameToggle
          name={habit.name}
          done={habit.doneToday}
          noteOpen={noteOpen}
          onToggle={onNoteToggle}
        />
        {habit.frequencyType === 'weekly' && (
          <div className="habit-week">
            {habit.weekCount}/{habit.weeklyTarget} this week
          </div>
        )}
        {habit.doneToday && noteOpen && (
          <TickNote
            note={habit.todayNote}
            onSave={(n) => onNote(habit, n)}
            onEditStart={onNoteInteract}
          />
        )}
      </div>
      {habit.streak > 0 && (
        <span className="habit-streak" aria-label={`${habit.streak} day streak`}>
          🔥 {habit.streak}
        </span>
      )}
      <button
        type="button"
        className="row-menu-btn"
        aria-label={`Options for ${habit.name}`}
        onClick={() => onMenu(habit)}
      >
        ⋯
      </button>
    </div>
  );
}
