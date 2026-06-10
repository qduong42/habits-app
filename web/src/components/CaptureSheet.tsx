// Quick-capture bottom sheet behind Today's floating "+": "💡 Dump a thought"
// expands an inline mini-capture (POST /inbox, no navigation); "➕ New habit"
// and "✅ New task" hand off to the parent-owned HabitForm/TaskForm.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCapture } from '../hooks/useInbox';

interface CaptureSheetProps {
  onClose: () => void;
  /** Open the HabitForm (the parent owns it); the sheet closes itself first. */
  onNewHabit: () => void;
  /** Open the TaskForm (the parent owns it); the sheet closes itself first. */
  onNewTask: () => void;
  /** A thought was captured — parent shows the "Captured 💡" toast. */
  onCaptured: () => void;
}

export default function CaptureSheet({
  onClose,
  onNewHabit,
  onNewTask,
  onCaptured,
}: CaptureSheetProps) {
  const capture = useCapture();
  const [dumpMode, setDumpMode] = useState(false);
  const [text, setText] = useState('');

  // Focus management + Escape, same pattern as HabitForm.
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleDump(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || capture.isPending) return;
    capture.mutate(
      { text: trimmed },
      {
        onSuccess: () => {
          onCaptured();
          onClose();
        },
      },
    );
  }

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="sheet action-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Quick capture"
        onClick={(e) => e.stopPropagation()}
      >
        {dumpMode ? (
          <form onSubmit={handleDump}>
            <h2 className="sheet-title">💡 Dump a thought</h2>
            <input
              className="capture-input mini-capture-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What's on your mind?"
              aria-label="Dump a thought"
              maxLength={5000}
              autoFocus
            />
            {capture.error && <p className="form-error">{capture.error.message}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={capture.isPending || text.trim() === ''}
              >
                {capture.isPending ? 'Capturing…' : 'Capture'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <h2 className="sheet-title">Add something</h2>
            <button type="button" className="action-btn" onClick={() => setDumpMode(true)}>
              💡 Dump a thought
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                onClose();
                onNewHabit();
              }}
            >
              ➕ New habit
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => {
                onClose();
                onNewTask();
              }}
            >
              ✅ New task
            </button>
            <button type="button" className="action-btn" onClick={onClose}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
