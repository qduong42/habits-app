// "+ note" chip on a just-done row: tap to type ("climbing 1 hr"), Enter
// saves, Escape cancels, Enter on an emptied input clears the note. Only
// rendered while the row is in its done state — same same-day window as undo.

import { useState } from 'react';

interface TickNoteProps {
  note: string | null;
  /** Receives the trimmed note; '' means clear. */
  onSave: (note: string) => void;
}

export default function TickNote({ note, onSave }: TickNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (editing) {
    return (
      <input
        className="tick-note-input"
        autoFocus
        value={draft}
        maxLength={2000}
        placeholder="Note — Enter saves, Esc cancels"
        aria-label="Tick note"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSave(draft.trim());
            setEditing(false);
          } else if (e.key === 'Escape') {
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
      />
    );
  }
  return (
    <button
      type="button"
      className={'tick-note' + (note === null ? ' tick-note-empty' : '')}
      aria-label={note === null ? 'Add a note' : `Edit note: ${note}`}
      onClick={() => {
        setDraft(note ?? '');
        setEditing(true);
      }}
    >
      {note ?? '+ note'}
    </button>
  );
}
