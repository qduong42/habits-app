// The activity name on a Today row. On done rows it doubles as the note-chip
// toggle (collapsed by default, same pattern as History entries); on open
// rows it is plain text. Shared by HabitRow and TaskRow.

interface NameToggleProps {
  name: string;
  done: boolean;
  noteOpen: boolean;
  onToggle: () => void;
}

export default function NameToggle({ name, done, noteOpen, onToggle }: NameToggleProps) {
  if (!done) return <div className="habit-name">{name}</div>;
  return (
    <button
      type="button"
      className="habit-name habit-name-toggle"
      aria-expanded={noteOpen}
      onClick={onToggle}
    >
      {name}
    </button>
  );
}
