// Card-by-card triage flow (Task 27, approved mockup): full-screen overlay,
// one dump item per screen with progress "2 / 5" in the header and four big
// option buttons — ✅ Task once (inline optional due date) / 🔁 Task recurring
// (inline interval picker) / 🌱 Habit (existing HabitForm convert mode on
// top) / 🗑 Let it go (inline optional answer note — the input is the
// confirm: Enter discards, even empty; Esc cancels the input only). Each
// action advances to the next item; the final card says "Mind clear 🧘".
// Esc / ✕ closes mid-flow (triage progress persists server-side naturally).

import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';
import { formatAge, taskNameFromDumpText } from '../format';
import { useConvertTask, useDiscard } from '../hooks/useInbox';
import HabitForm from './HabitForm';
import type { Achievement, ConvertTaskInput, InboxItem } from '../types';

const MAX_INTERVAL_HOURS = 8760; // one year — server-enforced ceiling

type Mode = 'idle' | 'once' | 'recurring' | 'habit' | 'letgo';
type IntervalUnit = 'hours' | 'days';

interface TriageCardProps {
  /** Snapshot of the open items when the flow started (progress denominator). */
  items: InboxItem[];
  /** True while a Celebration sits on top — its Esc handling wins. */
  paused: boolean;
  /** An action unlocked achievements — parent celebrates ON TOP of the flow. */
  onCelebrate: (unlocked: Achievement[]) => void;
  onClose: () => void;
}

export default function TriageCard({ items, paused, onCelebrate, onClose }: TriageCardProps) {
  const convertTask = useConvertTask();
  const discard = useDiscard();

  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('idle');
  const [dueDate, setDueDate] = useState('');
  // Raw typed text, not a numeric state: binding through valueAsNumber and
  // blanking on NaN wipes keystrokes on Android soft keyboards.
  const [intervalText, setIntervalText] = useState('1');
  const [intervalUnit, setIntervalUnit] = useState<IntervalUnit>('days');
  const [discardNote, setDiscardNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const total = items.length;
  const item = index < total ? items[index]! : null;
  const busy = convertTask.isPending || discard.isPending;

  const intervalValue = intervalText.trim() === '' ? NaN : Number(intervalText);
  const intervalHours = intervalUnit === 'days' ? intervalValue * 24 : intervalValue;
  // Fractional values are fine — the server accepts any interval >= 1h, so
  // e.g. 1.5 days (36h) or 0.5 days (12h) are valid recurring intervals.
  const intervalValid =
    Number.isFinite(intervalValue) && intervalHours >= 1 && intervalHours <= MAX_INTERVAL_HOURS;

  // Focus management, same pattern as the bottom sheets: trap entry on mount,
  // restore the previously focused element on unmount.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement;
    overlayRef.current?.focus();
    return () => {
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, []);

  // Esc closes mid-flow — except while the HabitForm or a Celebration is on
  // top (each has its own Esc handler that should win the keypress). In
  // 'letgo' mode Esc only cancels the note input, never the whole flow — the
  // input's own handler stops propagation, and this guard catches the
  // edge case where focus has left the input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape' || mode === 'habit' || paused) return;
      if (mode === 'letgo') {
        setMode('idle');
        setDiscardNote('');
      } else {
        onClose();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, paused, onClose]);

  /** Reset per-item state and move to the next card. */
  function advance() {
    setMode('idle');
    setDueDate('');
    setIntervalText('1');
    setIntervalUnit('days');
    setDiscardNote('');
    setActionError(null);
    setIndex((i) => i + 1);
  }

  function succeed(unlocked: Achievement[]) {
    if (unlocked.length > 0) onCelebrate(unlocked);
    advance();
  }

  function fail(err: unknown) {
    // Triaged from elsewhere meanwhile (409) or gone (404): nothing left to
    // decide for this card — just move on.
    if (err instanceof ApiError && (err.code === 'already_triaged' || err.status === 404)) {
      advance();
      return;
    }
    setActionError(err instanceof Error ? err.message : 'Something went wrong');
  }

  function submitTask(input: ConvertTaskInput) {
    if (!item || busy) return;
    setActionError(null);
    convertTask.mutate(
      { itemId: item.id, input },
      { onSuccess: (res) => succeed(res.unlockedAchievements), onError: fail },
    );
  }

  /** Enter in the note input — empty note discards without one; advances as before. */
  function letItGo() {
    if (!item || busy) return;
    const note = discardNote.trim();
    setActionError(null);
    discard.mutate(
      { itemId: item.id, ...(note !== '' ? { note } : {}) },
      { onSuccess: () => advance(), onError: fail },
    );
  }

  return (
    <div
      ref={overlayRef}
      tabIndex={-1}
      className="triage-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Triage"
    >
      <div className="triage-header">
        <span className="triage-progress">
          {Math.min(index + 1, total)} / {total}
        </span>
        <button type="button" className="triage-close" aria-label="Close triage" onClick={onClose}>
          ✕
        </button>
      </div>

      {item === null ? (
        <div className="triage-card triage-done-card">
          <p className="triage-done-title">Mind clear 🧘</p>
          <p className="triage-done-hint">Every thought has a home now.</p>
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      ) : (
        <div className="triage-card">
          <p className="triage-text">{item.text}</p>
          <div className="triage-meta">
            <span className="dump-age">{formatAge(item.createdAt)}</span>
            {item.sourceUrl && (
              <a
                className="dump-link"
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                🔗 source
              </a>
            )}
          </div>

          <div className="triage-options">
            <button
              type="button"
              className={'triage-option' + (mode === 'once' ? ' triage-option-active' : '')}
              disabled={busy}
              onClick={() => setMode(mode === 'once' ? 'idle' : 'once')}
            >
              ✅ Task — once
            </button>
            {mode === 'once' && (
              <div className="triage-inline">
                <input
                  type="date"
                  className="due-date-input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  aria-label="Due date (optional)"
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-primary triage-confirm"
                  disabled={busy}
                  onClick={() =>
                    submitTask({
                      name: taskNameFromDumpText(item.text),
                      ...(dueDate !== '' ? { dueDate } : {}),
                    })
                  }
                >
                  {convertTask.isPending ? 'Adding…' : 'Add task'}
                </button>
              </div>
            )}

            <button
              type="button"
              className={'triage-option' + (mode === 'recurring' ? ' triage-option-active' : '')}
              disabled={busy}
              onClick={() => setMode(mode === 'recurring' ? 'idle' : 'recurring')}
            >
              🔁 Task — recurring
            </button>
            {mode === 'recurring' && (
              <div className="triage-inline">
                <span className="triage-inline-label">every</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="interval-value"
                  value={intervalText}
                  onChange={(e) => setIntervalText(e.target.value)}
                  aria-label="Interval"
                  autoFocus
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
                <button
                  type="button"
                  className="btn-primary triage-confirm"
                  disabled={busy || !intervalValid}
                  onClick={() =>
                    submitTask({ name: taskNameFromDumpText(item.text), intervalHours })
                  }
                >
                  {convertTask.isPending ? 'Adding…' : 'Add task'}
                </button>
              </div>
            )}

            <button
              type="button"
              className="triage-option"
              disabled={busy}
              onClick={() => setMode('habit')}
            >
              🌱 Habit
            </button>

            <button
              type="button"
              className={
                'triage-option triage-option-letgo' +
                (mode === 'letgo' ? ' triage-option-active' : '')
              }
              disabled={busy}
              onClick={() => setMode(mode === 'letgo' ? 'idle' : 'letgo')}
            >
              🗑 Let it go
            </button>
            {mode === 'letgo' && (
              <div className="triage-inline">
                <input
                  className="capture-input"
                  value={discardNote}
                  onChange={(e) => setDiscardNote(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      letItGo();
                    } else if (e.key === 'Escape') {
                      // Cancel the note input only — never the triage flow
                      // (don't let the window Esc handler see this keypress).
                      e.stopPropagation();
                      setMode('idle');
                      setDiscardNote('');
                    }
                  }}
                  placeholder="Optional note — Enter to discard, Esc to cancel"
                  aria-label="Optional discard note"
                  maxLength={2000}
                  autoFocus
                />
              </div>
            )}
          </div>

          {actionError && <p className="form-error">{actionError}</p>}
        </div>
      )}

      {mode === 'habit' && item && (
        <HabitForm
          convertItem={item}
          onConverted={(res) => succeed(res.unlockedAchievements)}
          onClose={() => setMode('idle')}
        />
      )}
    </div>
  );
}
