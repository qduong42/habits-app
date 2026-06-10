// Dump tab (API name: inbox) — zero-friction capture box at the top (type →
// enter → posts → input clears, keep typing; collapsed optional link field),
// open items below with → Habit (convert via HabitForm) and Discard.
// Card-by-card triage + task outcomes land in Task 27.

import { useCallback, useRef, useState, type FormEvent } from 'react';
import Celebration, { type CelebrationData } from '../components/Celebration';
import HabitForm from '../components/HabitForm';
import { useCapture, useDiscard, useInbox } from '../hooks/useInbox';
import type { ConvertResponse, InboxItem } from '../types';

/** Age label for a dump item: "just now", "5m", "5h", "3d". */
function formatAge(createdAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(createdAt).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function Inbox() {
  const { data: items, isPending, error } = useInbox();
  const capture = useCapture();
  const discard = useDiscard();

  const [text, setText] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [convertItem, setConvertItem] = useState<InboxItem | null>(null);
  const [celebration, setCelebration] = useState<CelebrationData | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Focus stays in the text input after every capture so you can keep typing.
  const textRef = useRef<HTMLInputElement>(null);

  const closeCelebration = useCallback(() => setCelebration(null), []);

  function handleCapture(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || capture.isPending) return;
    const url = sourceUrl.trim();
    setActionError(null);
    capture.mutate(
      { text: trimmed, ...(url !== '' ? { sourceUrl: url } : {}) },
      { onError: (err) => setActionError(err.message) },
    );
    // Clear optimistically — the input is ready for the next thought even
    // while the POST is in flight; an error re-surfaces below the box.
    setText('');
    setSourceUrl('');
    textRef.current?.focus();
  }

  function handleConverted(res: ConvertResponse) {
    if (res.unlockedAchievements.length > 0) {
      setCelebration({ level: null, unlockedAchievements: res.unlockedAchievements });
    }
  }

  function handleDiscard(item: InboxItem) {
    if (!window.confirm('Let this thought go?')) return;
    setActionError(null);
    discard.mutate(item.id, { onError: (err) => setActionError(err.message) });
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

      {isPending ? (
        <p className="placeholder">Loading…</p>
      ) : error ? (
        <p className="form-error">Could not load dump items: {error.message}</p>
      ) : items && items.length === 0 ? (
        <div className="empty-state">
          <p>Mind full? Dump it here — then schedule it.</p>
        </div>
      ) : (
        <ul className="dump-list">
          {(items ?? []).map((item) => (
            <li key={item.id} className="dump-item">
              <div className="dump-item-top">
                <p className="dump-text">{item.text}</p>
                <span className="dump-age">{formatAge(item.createdAt)}</span>
              </div>
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
                  className="dump-btn dump-btn-habit"
                  onClick={() => setConvertItem(item)}
                >
                  → Habit
                </button>
                <button
                  type="button"
                  className="dump-btn dump-btn-discard"
                  onClick={() => handleDiscard(item)}
                  disabled={discard.isPending}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
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
