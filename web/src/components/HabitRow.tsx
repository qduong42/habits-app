// One habit row: round check circle, name, weekly progress line, streak
// flame, ⋯ menu. Weekly habits whose target is met but weren't done today
// render in the done style with the circle disabled.

import type { Habit } from '../types';

interface HabitRowProps {
  habit: Habit;
  onToggle: (habit: Habit, done: boolean) => void;
  onMenu: (habit: Habit) => void;
}

export default function HabitRow({ habit, onToggle, onMenu }: HabitRowProps) {
  const weeklyMet =
    habit.frequencyType === 'weekly' &&
    habit.weeklyTarget !== null &&
    habit.weekCount >= habit.weeklyTarget;
  const doneStyle = habit.doneToday || weeklyMet;
  const circleDisabled = weeklyMet && !habit.doneToday;

  return (
    <div className={'habit-row' + (doneStyle ? ' habit-row-done' : '')}>
      <button
        type="button"
        className={'check-circle' + (habit.doneToday ? ' check-circle-done' : '')}
        disabled={circleDisabled}
        aria-label={habit.doneToday ? `Uncheck ${habit.name}` : `Check off ${habit.name}`}
        onClick={() => onToggle(habit, !habit.doneToday)}
      >
        {habit.doneToday ? '✓' : ''}
      </button>
      <div className="habit-main">
        <div className="habit-name">{habit.name}</div>
        {habit.frequencyType === 'weekly' && (
          <div className="habit-week">
            {habit.weekCount}/{habit.weeklyTarget} this week
          </div>
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
