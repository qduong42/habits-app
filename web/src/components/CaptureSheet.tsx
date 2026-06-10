// Add sheet behind Today's floating "+": "✅ New task" and "➕ New habit" hand
// off to the parent-owned TaskForm/HabitForm. Dumping thoughts lives on the
// Dump tab only (removed from here 2026-06-10 per Huy — tasks/habits only).

import Sheet from './Sheet';

interface CaptureSheetProps {
  onClose: () => void;
  /** Open the HabitForm (the parent owns it); the sheet closes itself first. */
  onNewHabit: () => void;
  /** Open the TaskForm (the parent owns it); the sheet closes itself first. */
  onNewTask: () => void;
}

export default function CaptureSheet({ onClose, onNewHabit, onNewTask }: CaptureSheetProps) {
  return (
    <Sheet label="Add something" className="action-sheet" onClose={onClose}>
      <h2 className="sheet-title">Add something</h2>
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
      <button type="button" className="action-btn" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}
