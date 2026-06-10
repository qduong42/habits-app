// Dump tab (API name: inbox) — zero-friction capture box at the top (type →
// enter → posts → input clears, keep typing; collapsed optional link field),
// a "Triage N items →" button opening the card-by-card flow (TriageCard),
// the open items below with → Task (FIRST, immediate one-off undated convert)
// / → Habit / Discard per-item shortcuts, and the braindump History at the
// bottom (collapsed date rows, lazily fetched on first expansion).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Celebration, { type CelebrationData } from '../components/Celebration';
import HabitForm from '../components/HabitForm';
import TriageCard from '../components/TriageCard';
import { formatAge, formatDumpDate, formatTime, localDateKey, taskNameFromDumpText } from '../format';
import {
  useCapture,
  useClearHistory,
  useConvertTask,
  useDeleteHistoryItem,
  useDiscard,
  useInbox,
  useInboxAll,
} from '../hooks/useInbox';
import type { Achievement, ConvertResponse, InboxItem } from '../types';

/** History status label: 🗑 / ✅ / 🌱; converted with both links null = deleted. */
function historyStatusLabel(item: InboxItem): string {
  if (item.status === 'discarded') return '🗑 discarded';
  if (item.taskId !== null) return '✅ task';
  if (item.habitId !== null) return '🌱 habit';
  return 'converted (since deleted)';
}

export default function Inbox() {
  const { data: items, isPending, error } = useInbox();
  const capture = useCapture();
  const convertTask = useConvertTask();
  const discard = useDiscard();
  const deleteHistoryItem = useDeleteHistoryItem();
  const clearHistory = useClearHistory();

  const [text, setText] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [convertItem, setConvertItem] = useState<InboxItem | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // The inline discard-note input IS the confirm (no window.confirm): Enter
  // (even empty) discards, Escape cancels. One item at a time.
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [discardNote, setDiscardNote] = useState('');
  // Snapshot of the open items when triage starts — fixes the "2 / 5"
  // progress denominator while actions remove items from the live query.
  const [triageQueue, setTriageQueue] = useState<InboxItem[] | null>(null);
  // "Task created ✓" inline confirmation for the → Task quick action — the
  // converted item leaves the open list, so the message lives above it.
  const [taskCreated, setTaskCreated] = useState(false);
  const taskCreatedTimer = useRef<number | undefined>(undefined);
  // History: section toggle + per-date expansion. historyRequested latches
  // true on first expansion and never resets — it fires the lazy ?all=1 query.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRequested, setHistoryRequested] = useState(false);
  const [openDates, setOpenDates] = useState<ReadonlySet<string>>(new Set());
  const history = useInboxAll(historyRequested);

  // Focus stays in the text input after every capture so you can keep typing.
  const textRef = useRef<HTMLInputElement>(null);

  const closeCelebration = useCallback(() => setCelebration(null), []);

  useEffect(() => () => window.clearTimeout(taskCreatedTimer.current), []);

  // Non-open items grouped by dump date (browser-local createdAt). The server
  // returns createdAt desc, so Map insertion order is already newest-date
  // first and items within a date are newest first.
  const historyGroups = useMemo(() => {
    const groups = new Map<string, InboxItem[]>();
    for (const item of history.data ?? []) {
      if (item.status === 'open') continue; // open items are the list above
      const key = localDateKey(item.createdAt);
      const group = groups.get(key);
      if (group) group.push(item);
      else groups.set(key, [item]);
    }
    return [...groups.entries()];
  }, [history.data]);

  function handleCapture(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || capture.isPending) return;
    const url = sourceUrl.trim();
    setActionError(null);
    capture.mutate(
      { text: trimmed, ...(url !== '' ? { sourceUrl: url } : {}) },
      {
        onError: (err) => {
          setActionError(err.message);
          // The POST failed after the optimistic clear below — restore what
          // was typed (unless the user already started the next thought).
          setText((current) => (current === '' ? trimmed : current));
          setSourceUrl((current) => (current === '' ? url : current));
        },
      },
    );
    // Clear optimistically — the input is ready for the next thought even
    // while the POST is in flight; an error re-surfaces below the box.
    setText('');
    setSourceUrl('');
    textRef.current?.focus();
  }

  function celebrate(unlocked: Achievement[]) {
    if (unlocked.length > 0) {
      setCelebration({ level: null, unlockedAchievements: unlocked });
    }
  }

  function handleConverted(res: ConvertResponse) {
    celebrate(res.unlockedAchievements);
  }

  /** → Task quick action: immediate one-off undated convert, zero friction.
   * Name = first line (≤200), notes = full text — mirrors the habit prefill
   * rule. Scheduling happens later via the task's ⋯ Edit or the Triage flow. */
  function quickTask(item: InboxItem) {
    if (convertTask.isPending) return;
    setActionError(null);
    convertTask.mutate(
      { itemId: item.id, input: { name: taskNameFromDumpText(item.text), notes: item.text } },
      {
        onSuccess: (res) => {
          setTaskCreated(true);
          window.clearTimeout(taskCreatedTimer.current);
          taskCreatedTimer.current = window.setTimeout(() => setTaskCreated(false), 2500);
          celebrate(res.unlockedAchievements);
        },
        onError: (err) => setActionError(err.message),
      },
    );
  }

  function cancelDiscard() {
    setDiscardingId(null);
    setDiscardNote('');
  }

  /** Enter in the note input — empty note discards without one. Clears the
   * input only on success (matching TriageCard): on error the typed note
   * stays put so it isn't lost. */
  function confirmDiscard(item: InboxItem) {
    if (discard.isPending) return;
    const note = discardNote.trim();
    setActionError(null);
    discard.mutate(
      { itemId: item.id, ...(note !== '' ? { note } : {}) },
      { onSuccess: () => cancelDiscard(), onError: (err) => setActionError(err.message) },
    );
  }

  function toggleHistory() {
    setHistoryOpen((open) => !open);
    setHistoryRequested(true); // latch — fires the lazy ?all=1 query once
  }

  function toggleDate(key: string) {
    setOpenDates((dates) => {
      const next = new Set(dates);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** ✕ on a history row — immediate hard delete, no confirm (it's history). */
  function deleteHistory(item: InboxItem) {
    if (deleteHistoryItem.isPending) return;
    setActionError(null);
    deleteHistoryItem.mutate(item.id, { onError: (err) => setActionError(err.message) });
  }

  /** "Clear" on a date row — confirm, then send that group's exact ids (the
   * server ignores any that turned open/foreign/missing in the meantime).
   * The group row disappears on its own once the refetch returns it empty. */
  function clearDay(group: InboxItem[]) {
    if (clearHistory.isPending) return;
    const label = formatDumpDate(group[0]!.createdAt);
    const noun = group.length === 1 ? 'history item' : 'history items';
    if (!window.confirm(`Delete ${group.length} ${noun} from ${label}?`)) return;
    setActionError(null);
    clearHistory.mutate(
      group.map((item) => item.id),
      { onError: (err) => setActionError(err.message) },
    );
  }

  function handleDiscardKeyDown(e: KeyboardEvent<HTMLInputElement>, item: InboxItem) {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmDiscard(item);
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // cancel the input only — nothing above should react
      cancelDiscard();
    }
  }

  return (
    <div className="dump-page">
      <h1 className="page-title">Dump</h1>

      <form className="capture-box" onSubmit={handleCapture}>
        <div className="capture-row">
          <input
            ref={textRef}
            className="capture-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's on your mind?"
            aria-label="Dump a thought"
            maxLength={5000}
          />
          <button
            type="submit"
            className="capture-submit"
            aria-label="Capture"
            disabled={text.trim() === ''}
          >
            ↵
          </button>
        </div>
        {linkOpen ? (
          <input
            className="capture-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://… (optional source link)"
            aria-label="Source link"
            maxLength={2000}
            autoFocus
          />
        ) : (
          <button type="button" className="capture-link-toggle" onClick={() => setLinkOpen(true)}>
            + add link
          </button>
        )}
      </form>

      {actionError && <p className="form-error">{actionError}</p>}
      {taskCreated && (
        <p className="dump-task-created" role="status">
          Task created ✓
        </p>
      )}

      {isPending ? (
        <p className="placeholder">Loading…</p>
      ) : error ? (
        <p className="form-error">Could not load dump items: {error.message}</p>
      ) : items && items.length === 0 ? (
        <div className="empty-state">
          <p>Mind full? Dump it here — then schedule it.</p>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="triage-start"
            onClick={() => setTriageQueue(items ?? [])}
          >
            Triage {items?.length} item{items?.length === 1 ? '' : 's'} →
          </button>
          <ul className="dump-list">
            {(items ?? []).map((item) => (
              <li key={item.id} className="dump-item">
                <div className="dump-item-top">
                  <p className="dump-text">{item.text}</p>
                  <span className="dump-age">{formatAge(item.createdAt)}</span>
                </div>
                {discardingId === item.id ? (
                  <input
                    className="capture-url"
                    value={discardNote}
                    onChange={(e) => setDiscardNote(e.target.value)}
                    onKeyDown={(e) => handleDiscardKeyDown(e, item)}
                    placeholder="Optional note — Enter to discard, Esc to cancel"
                    aria-label="Optional discard note"
                    maxLength={2000}
                    autoFocus
                  />
                ) : (
                  <div className="dump-item-actions">
                    {item.sourceUrl && (
                      <a
                        className="dump-link"
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open source link"
                      >
                        🔗
                      </a>
                    )}
                    <button
                      type="button"
                      className="dump-btn dump-btn-task"
                      onClick={() => quickTask(item)}
                      disabled={convertTask.isPending}
                    >
                      → Task
                    </button>
                    <button
                      type="button"
                      className="dump-btn dump-btn-habit"
                      onClick={() => setConvertItem(item)}
                    >
                      → Habit
                    </button>
                    <button
                      type="button"
                      className="dump-btn dump-btn-discard"
                      onClick={() => {
                        setDiscardingId(item.id);
                        setDiscardNote('');
                      }}
                      disabled={discard.isPending}
                    >
                      Discard
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <section className="dump-history">
        <button
          type="button"
          className="dump-history-toggle"
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
            <p className="placeholder">Nothing triaged yet.</p>
          ) : (
            <ul className="dump-history-dates">
              {historyGroups.map(([key, group]) => (
                <li key={key} className="dump-history-date">
                  <div className="dump-history-date-row">
                    <button
                      type="button"
                      className="dump-history-date-toggle"
                      aria-expanded={openDates.has(key)}
                      onClick={() => toggleDate(key)}
                    >
                      {formatDumpDate(group[0]!.createdAt)} · {group.length} item
                      {group.length === 1 ? '' : 's'}
                    </button>
                    <button
                      type="button"
                      className="dump-history-clear"
                      aria-label={`Clear all history from ${formatDumpDate(group[0]!.createdAt)}`}
                      onClick={() => clearDay(group)}
                      disabled={clearHistory.isPending}
                    >
                      Clear
                    </button>
                  </div>
                  {openDates.has(key) && (
                    <ul className="dump-history-items">
                      {group.map((item) => (
                        <li key={item.id} className="dump-history-item">
                          <div className="dump-history-item-top">
                            <span className="dump-history-time">{formatTime(item.createdAt)}</span>
                            <p className="dump-history-text">{item.text}</p>
                            <span className="dump-history-status">{historyStatusLabel(item)}</span>
                            <button
                              type="button"
                              className="dump-history-delete"
                              aria-label="Delete this history item"
                              onClick={() => deleteHistory(item)}
                              disabled={deleteHistoryItem.isPending}
                            >
                              ✕
                            </button>
                          </div>
                          {item.discardNote !== null && (
                            <p className="dump-history-note">{item.discardNote}</p>
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

      {triageQueue && (
        <TriageCard
          items={triageQueue}
          paused={celebration !== null}
          onCelebrate={celebrate}
          onClose={() => setTriageQueue(null)}
        />
      )}

      {convertItem && (
        <HabitForm
          convertItem={convertItem}
          onConverted={handleConverted}
          onClose={() => setConvertItem(null)}
        />
      )}

      {celebration && (
        <Celebration
          level={celebration.level}
          unlockedAchievements={celebration.unlockedAchievements}
          onClose={closeCelebration}
        />
      )}
    </div>
  );
}
