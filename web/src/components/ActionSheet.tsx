// Shared ⋯ row-menu sheet (Today's habit and task menus): a titled list of
// action buttons plus Cancel, on the common Sheet scaffold.

import Sheet from './Sheet';

export interface ActionSheetAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface ActionSheetProps {
  /** Row name — shown as the sheet title and used for the dialog label. */
  title: string;
  actions: ActionSheetAction[];
  onClose: () => void;
}

export default function ActionSheet({ title, actions, onClose }: ActionSheetProps) {
  return (
    <Sheet label={`Options for ${title}`} className="action-sheet" onClose={onClose}>
      <h2 className="sheet-title">{title}</h2>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          className={'action-btn' + (action.danger ? ' action-btn-danger' : '')}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
      <button type="button" className="action-btn" onClick={onClose}>
        Cancel
      </button>
    </Sheet>
  );
}
