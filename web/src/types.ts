// Frontend mirrors of the shared API contracts in
// docs/superpowers/plans/2026-06-09-habits-app-v1.md — single source of truth,
// do not drift from the server's shapes.

export interface Category {
  id: string;
  name: string;
  emoji: string;
  color: string;
  builtin: boolean;
}

export interface Habit {
  id: string;
  name: string;
  notes: string | null;
  sourceUrl: string | null;
  category: Category;
  frequencyType: 'daily' | 'weekly';
  weeklyTarget: number | null;
  /** daily: true; weekly: weekCount < weeklyTarget || doneToday */
  scheduledToday: boolean;
  doneToday: boolean;
  weekCount: number;
  streak: number;
}

/** GET /habits */
export interface HabitsResponse {
  /** YYYY-MM-DD in the user's timezone */
  today: string;
  habits: Habit[];
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  emoji: string;
  unlockedAt: string | null;
}

/** POST /habits/:id/checkin — XP fields are zeroed until Task 13. */
export interface CheckinResponse {
  xpGained: number;
  xpTotal: number;
  level: number;
  leveledUp: boolean;
  habitStreak: number;
  unlockedAchievements: Achievement[];
}

/**
 * DELETE /habits/:id/checkin. NOTE: when the server floor-clamps XP at 0,
 * xpLost may exceed the actual deduction — always trust xpTotal/level.
 */
export interface UndoResponse {
  ok: boolean;
  xpLost: number;
  xpTotal: number;
  level: number;
}

/** POST /habits body. Weekly requires weeklyTarget; daily must omit it. */
export interface HabitInput {
  name: string;
  categoryId: string;
  frequencyType: 'daily' | 'weekly';
  weeklyTarget?: number;
  notes?: string;
  sourceUrl?: string;
}

/** PATCH /habits/:id body. Switching weekly→daily must omit weeklyTarget. */
export interface HabitPatch {
  name?: string;
  categoryId?: string;
  frequencyType?: 'daily' | 'weekly';
  weeklyTarget?: number;
  notes?: string | null;
  sourceUrl?: string | null;
}

/** POST /categories body. color must be #rrggbb. */
export interface CategoryInput {
  name: string;
  emoji: string;
  color: string;
}

/** Dump item (UI name) — DB/API keep "inbox". */
export interface InboxItem {
  id: string;
  text: string;
  sourceUrl: string | null;
  status: 'open' | 'converted' | 'discarded';
  habitId: string | null;
  taskId: string | null;
  createdAt: string;
}

/** POST /inbox body. */
export interface CaptureInput {
  text: string;
  sourceUrl?: string;
}

/**
 * POST /inbox/:id/convert body — like HabitInput minus sourceUrl (the URL
 * carries over from the dump item, never from the client).
 */
export interface ConvertInput {
  name: string;
  categoryId: string;
  frequencyType: 'daily' | 'weekly';
  weeklyTarget?: number;
  notes?: string;
}

/** POST /inbox/:id/convert response. */
export interface ConvertResponse {
  item: InboxItem;
  habit: Habit;
  unlockedAchievements: Achievement[];
}
