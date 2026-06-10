// Shared bottom-sheet scaffold: scrim (tap to close), dialog semantics,
// focus-trap entry/restore and Escape-to-close. HabitForm, TaskForm,
// CaptureSheet and ActionSheet all render inside this — the a11y wiring
// lives once here.

import { useEffect, useRef, type ReactNode } from 'react';

interface SheetProps {
  /** Accessible dialog name (aria-label). */
  label: string;
  onClose: () => void;
  /** Extra class(es) on the sheet panel, e.g. 'action-sheet'. */
  className?: string;
  children: ReactNode;
}

export default function Sheet({ label, onClose, className, children }: SheetProps) {
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

  // Escape closes the sheet (carry-over a11y fix from the Task 9 review).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div
        ref={sheetRef}
        tabIndex={-1}
        className={'sheet' + (className ? ` ${className}` : '')}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
