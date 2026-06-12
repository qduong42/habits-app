// State machine for the Today-row note chips: collapsed by default, a fresh
// tick auto-expands the row's chip for 30s (then it collapses on its own),
// any manual interaction — toggling the name or opening the editor — is
// sticky and cancels the timer. Extracted from Today.tsx so the page only
// wires callbacks.

import { useEffect, useRef, useState } from 'react';

const AUTO_COLLAPSE_MS = 30_000;

/** Immutable set-membership update shared by the toggle helpers. */
export function setWith(
  prev: ReadonlySet<string>,
  id: string,
  present: boolean,
): ReadonlySet<string> {
  const next = new Set(prev);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}

export function useNoteChips() {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());

  function cancelTimer(id: string) {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
  }, []);

  /** Manual tap on the activity name — sticky either way. */
  function toggle(id: string) {
    cancelTimer(id);
    setOpen((prev) => setWith(prev, id, !prev.has(id)));
  }

  /** Fresh tick → auto-expand for 30s; undo → collapse immediately. */
  function autoExpand(id: string, done: boolean) {
    cancelTimer(id);
    setOpen((prev) => setWith(prev, id, done));
    if (done) {
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id);
          setOpen((prev) => setWith(prev, id, false));
        }, AUTO_COLLAPSE_MS),
      );
    }
  }

  return { isOpen: (id: string) => open.has(id), toggle, autoExpand, cancelTimer };
}
