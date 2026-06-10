// Bottom-sheet habit form — create (no `habit` prop), edit (prefilled from
// `habit`), or convert (prefilled from a dump item via `convertItem`; submit
// hits POST /inbox/:id/convert instead of POST /habits). Category select
// offers an inline "+ New category" mode that POSTs to /categories and
// selects the result.

import { useState, type FormEvent } from 'react';
import Sheet from './Sheet';
import {
  useCategories,
  useCreateCategory,
  useCreateHabit,
  useUpdateHabit,
} from '../hooks/useHabits';
import { useConvert } from '../hooks/useInbox';
import type {
  ConvertInput,
  ConvertResponse,
  Habit,
  HabitInput,
  HabitPatch,
  InboxItem,
} from '../types';

const NEW_CATEGORY = '__new__';

/** Dump text → habit-name prefill: first line, capped at ~60 chars. */
function nameFromDumpText(text: string): string {
  const firstLine = text.split('\n', 1)[0]!.trim();
  return firstLine.length > 60 ? firstLine.slice(0, 59).trimEnd() + '…' : firstLine;
}

interface HabitFormProps {
  habit?: Habit;
  /** Convert mode: prefill from this dump item; submit converts it. */
  convertItem?: InboxItem;
  /** Called (before onClose) with the server response when a convert succeeds. */
  onConverted?: (res: ConvertResponse) => void;
  onClose: () => void;
}

export default function HabitForm({ habit, convertItem, onConverted, onClose }: HabitFormProps) {
  const categories = useCategories();
  const createCategory = useCreateCategory();
  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const convert = useConvert();

  const [name, setName] = useState(
    habit?.name ?? (convertItem ? nameFromDumpText(convertItem.text) : ''),
  );
  const [categoryId, setCategoryId] = useState(habit?.category.id ?? '');
  const [frequencyType, setFrequencyType] = useState<'daily' | 'weekly'>(
    habit?.frequencyType ?? 'daily',
  );
  const [weeklyTarget, setWeeklyTarget] = useState(habit?.weeklyTarget ?? 3);
  const [notes, setNotes] = useState(habit?.notes ?? convertItem?.text ?? '');

  // Inline new-category mode.
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('✨');
  const [newCatColor, setNewCatColor] = useState('#5e35b1');

  // Fall back to the first category once the list loads (create mode).
  const effectiveCategoryId =
    categoryId !== '' ? categoryId : (categories.data?.[0]?.id ?? '');
  const newCategoryMode = categoryId === NEW_CATEGORY;

  const saving = createHabit.isPending || updateHabit.isPending || convert.isPending;
  const error =
    createHabit.error ??
    updateHabit.error ??
    convert.error ??
    createCategory.error ??
    categories.error;

  async function addCategory() {
    const trimmed = newCatName.trim();
    const emoji = newCatEmoji.trim();
    if (!trimmed || !emoji) return;
    const created = await createCategory.mutateAsync({
      name: trimmed,
      emoji,
      color: newCatColor,
    });
    setCategoryId(created.id);
    setNewCatName('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || !effectiveCategoryId || newCategoryMode || saving) return;
    try {
      if (habit) {
        const patch: HabitPatch = {
          name: trimmedName,
          categoryId: effectiveCategoryId,
          frequencyType,
          notes: notes.trim() === '' ? null : notes.trim(),
        };
        // weekly→daily must omit weeklyTarget (the server clears it).
        if (frequencyType === 'weekly') patch.weeklyTarget = weeklyTarget;
        await updateHabit.mutateAsync({ id: habit.id, patch });
      } else if (convertItem) {
        // Convert mode: POST /inbox/:id/convert, not POST /habits — the
        // server creates the habit AND closes the dump item atomically.
        const input: ConvertInput = {
          name: trimmedName,
          categoryId: effectiveCategoryId,
          frequencyType,
        };
        if (frequencyType === 'weekly') input.weeklyTarget = weeklyTarget;
        if (notes.trim() !== '') input.notes = notes.trim();
        const res = await convert.mutateAsync({ itemId: convertItem.id, input });
        onConverted?.(res);
      } else {
        const input: HabitInput = {
          name: trimmedName,
          categoryId: effectiveCategoryId,
          frequencyType,
        };
        if (frequencyType === 'weekly') input.weeklyTarget = weeklyTarget;
        if (notes.trim() !== '') input.notes = notes.trim();
        await createHabit.mutateAsync(input);
      }
      onClose();
    } catch {
      // Error stays visible via the mutation state rendered below.
    }
  }

  return (
    <Sheet
      label={habit ? 'Edit habit' : convertItem ? 'Turn into habit' : 'New habit'}
      onClose={onClose}
    >
      <h2 className="sheet-title">
        {habit ? 'Edit habit' : convertItem ? '🌱 Turn into habit' : 'New habit'}
      </h2>
      <form onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Stretch 10 minutes"
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Category</span>
          <select
            className="select"
            value={newCategoryMode ? NEW_CATEGORY : effectiveCategoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
            <option value={NEW_CATEGORY}>+ New category</option>
          </select>
        </label>

        {newCategoryMode && (
          <div className="new-category">
            <div className="new-category-row">
              <input
                className="new-cat-emoji"
                value={newCatEmoji}
                onChange={(e) => setNewCatEmoji(e.target.value)}
                aria-label="Category emoji"
              />
              <input
                className="new-cat-name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category name"
                aria-label="Category name"
              />
              <input
                type="color"
                className="new-cat-color"
                value={newCatColor}
                onChange={(e) => setNewCatColor(e.target.value)}
                aria-label="Category color"
              />
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void addCategory()}
              disabled={createCategory.isPending || newCatName.trim() === ''}
            >
              {createCategory.isPending ? 'Adding…' : 'Add category'}
            </button>
          </div>
        )}

        <div className="field">
          <span className="field-label">Frequency</span>
          <div className="freq-toggle" role="radiogroup" aria-label="Frequency">
            <button
              type="button"
              role="radio"
              aria-checked={frequencyType === 'daily'}
              className={'freq-option' + (frequencyType === 'daily' ? ' freq-active' : '')}
              onClick={() => setFrequencyType('daily')}
            >
              Daily
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={frequencyType === 'weekly'}
              className={'freq-option' + (frequencyType === 'weekly' ? ' freq-active' : '')}
              onClick={() => setFrequencyType('weekly')}
            >
              Weekly
            </button>
          </div>
        </div>

        {frequencyType === 'weekly' && (
          <div className="field">
            <span className="field-label">Times per week</span>
            <div className="stepper">
              <button
                type="button"
                aria-label="Decrease weekly target"
                onClick={() => setWeeklyTarget((t) => Math.max(1, t - 1))}
              >
                −
              </button>
              <span className="stepper-value">{weeklyTarget}</span>
              <button
                type="button"
                aria-label="Increase weekly target"
                onClick={() => setWeeklyTarget((t) => Math.min(7, t + 1))}
              >
                +
              </button>
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">Notes (optional)</span>
          <textarea
            className="notes-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>

        {error && <p className="form-error">{error.message}</p>}

        <div className="sheet-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary"
            disabled={saving || newCategoryMode || name.trim() === '' || !effectiveCategoryId}
          >
            {saving ? 'Saving…' : habit ? 'Save changes' : 'Create habit'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
