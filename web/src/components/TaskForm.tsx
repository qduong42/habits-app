// Bottom-sheet task form — create (no `task` prop) via POST /tasks or edit
// via PATCH /tasks/:id. Mode toggle "once / recurring": once → optional,
// clearable due date; recurring → interval as number + unit (hours/days),
// stored as hours (days × 24), 1–8760. Same a11y patterns as HabitForm
// (focus trap entry/restore, Escape, aria-modal, explicit Cancel).

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCreateTask, useUpdateTask } from '../hooks/useTasks';
import type { TaskInput, TaskItem, TaskPatch } from '../types';

const MAX_INTERVAL_HOURS = 8760; // one year — server-enforced ceiling

type Mode = 'once' | 'recurring';
type IntervalUnit = 'hours' | 'days';

interface TaskFormProps {
  /** Edit mode: prefill from this task; submit PATCHes it. */
  task?: TaskItem;
  onClose: () => void;
}

export default function TaskForm({ task, onClose }: TaskFormProps) {
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();

  const [name, setName] = useState(task?.name ?? '');
  const [mode, setMode] = useState<Mode>(task?.kind === 'recurring' ? 'recurring' : 'once');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');

  // Interval prefill: whole-day intervals show as days (120h → 5 days).
  const initialInterval = task?.intervalHours ?? 24;
  const wholeDays = initialInterval % 24 === 0;
  const [intervalValue, setIntervalValue] = useState(
    wholeDays ? initialInterval / 24 : initialInterval,
  );
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>(wholeDays ? 'days' : 'hours');

  const intervalHours =
    intervalUnit === 'days' ? intervalValue * 24 : intervalValue;
  const intervalValid =
    Number.isInteger(intervalValue) && intervalHours >= 1 && intervalHours <= MAX_INTERVAL_HOURS;

  // Focus management: trap entry on mount (unless autoFocus already put focus
  // inside the sheet), restore the previously focused element on unmount.
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    if (!sheetRef.current?.contains(document.activeElement)) {
      sheetRef.current?.focus();
    }
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // Escape closes the sheet.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const saving = createTask.isPending || updateTask.isPending;
  const error = createTask.error ?? updateTask.error;
  const submittable =
    name.trim() !== '' && (mode === 'once' || intervalValid) && !saving;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!submittable) return;
    const trimmedName = name.trim();
    const trimmedNotes = notes.trim();
    try {
      if (task) {
        // PATCH clears the other mode's field explicitly (dueDate XOR
        // intervalHours server-side); re-sending an unchanged intervalHours
        // keeps the task's nextDue anchor.
        const patch: TaskPatch = {
          name: trimmedName,
          notes: trimmedNotes === '' ? null : trimmedNotes,
          ...(mode === 'recurring'
            ? { intervalHours, dueDate: null }
            : { dueDate: dueDate === '' ? null : dueDate, intervalHours: null }),
        };
        await updateTask.mutateAsync({ id: task.id, patch });
      } else {
        const input: TaskInput = { name: trimmedName };
        if (trimmedNotes !== '') input.notes = trimmedNotes;
        if (mode === 'recurring') input.intervalHours = intervalHours;
        else if (dueDate !== '') input.dueDate = dueDate;
        await createTask.mutateAsync(input);
      }
      onClose();
    } catch {
      // Error stays visible via the mutation state rendered below.
    }
  }

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={task ? 'Edit task' : 'New task'}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="sheet-title">{task ? 'Edit task' : '✅ New task'}</h2>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Water the plants"
              autoFocus
              required
            />
          </label>

          <div className="field">
            <span className="field-label">Type</span>
            <div className="freq-toggle" role="radiogroup" aria-label="Task type">
              <button
                type="button"
                className={'freq-option' + (mode === 'once' ? ' freq-active' : '')}
                onClick={() => setMode('once')}
              >
                Once
              </button>
              <button
                type="button"
                className={'freq-option' + (mode === 'recurring' ? ' freq-active' : '')}
                onClick={() => setMode('recurring')}
              >
                Recurring
              </button>
            </div>
          </div>

          {mode === 'once' ? (
            <div className="field">
              <span className="field-label">Due date (optional)</span>
              <div className="due-date-row">
                <input
                  type="date"
                  className="due-date-input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Due date"
                />
                {dueDate !== '' && (
                  <button
                    type="button"
                    className="due-date-clear"
                    onClick={() => setDueDate('')}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="field">
              <span className="field-label">Repeat every</span>
              <div className="interval-row">
                <input
                  type="number"
                  className="interval-value"
                  min={1}
                  max={intervalUnit === 'days' ? MAX_INTERVAL_HOURS / 24 : MAX_INTERVAL_HOURS}
                  step={1}
                  value={Number.isNaN(intervalValue) ? '' : intervalValue}
                  onChange={(e) => setIntervalValue(e.target.valueAsNumber)}
                  aria-label="Interval"
                  required
                />
                <select
                  className="interval-unit"
                  value={intervalUnit}
                  onChange={(e) => setIntervalUnit(e.target.value as IntervalUnit)}
                  aria-label="Interval unit"
                >
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
              </div>
              {!intervalValid && !Number.isNaN(intervalValue) && (
                <p className="form-error interval-error">
                  Interval must be a whole number between 1 hour and 1 year.
                </p>
              )}
            </div>
          )}

          <label className="field">
            <span className="field-label">Notes (optional)</span>
            <textarea
              className="notes-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </label>

          {error && <p className="form-error">{error.message}</p>}

          <div className="sheet-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!submittable}>
              {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
