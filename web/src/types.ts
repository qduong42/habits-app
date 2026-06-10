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

/** POST /habits/:id/checkin. */
export interface CheckinResponse {
  xpGained: number;
  xpTotal: number;
  level: number;
  leveledUp: boolean;
  habitStreak: number;
  unlockedAchievements: Achievement[];
}

/**
 * DELETE /habits/:id/checkin (and DELETE /tasks/:id/complete — same shape).
 * NOTE: when the server floor-clamps XP at 0, xpLost may exceed the actual
 * deduction — always trust xpTotal/level.
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

/**
 * Task groups — server-computed. 'scheduled' = not yet due (recurring before
 * nextDue, future-dated one-offs); the default GET /tasks excludes it, GET
 * /tasks?all=1 appends scheduled tasks last (Task 26 contract extension).
 */
export type TaskGroup = 'overdue' | 'today' | 'undated' | 'done' | 'scheduled';

/** GET /tasks item. */
export interface TaskItem {
  id: string;
  name: string;
  notes: string | null;
  sourceUrl: string | null;
  kind: 'oneoff' | 'recurring';
  group: TaskGroup;
  /** 'overdue 1d' | 'overdue 3h' | 'due today' | 'due 20:00' | 'due Jun 13' | null */
  dueLabel: string | null;
  dueDate: string | null;
  intervalHours: number | null;
  nextDue: string | null;
}

/** GET /tasks(?all=1) → ordered overdue, today, undated, done(, scheduled). */
export interface TasksResponse {
  tasks: TaskItem[];
}

/** POST /tasks/:id/complete. The undo (DELETE) reuses UndoResponse. */
export interface TaskCompleteResponse {
  xpGained: number;
  xpTotal: number;
  level: number;
  leveledUp: boolean;
  /** Recurring only; null for one-offs. */
  nextDue: string | null;
  unlockedAchievements: Achievement[];
}

/** POST /tasks body. dueDate (one-off) XOR intervalHours (recurring, 1-8760). */
export interface TaskInput {
  name: string;
  notes?: string;
  dueDate?: string;
  intervalHours?: number;
}

/** PATCH /tasks/:id body. null clears: dueDate, or intervalHours (→ one-off). */
export interface TaskPatch {
  name?: string;
  notes?: string | null;
  dueDate?: string | null;
  intervalHours?: number | null;
}

/** GET /stats — per-habit aggregates (active habits only). */
export interface StatsHabit {
  id: string;
  name: string;
  /** Category emoji — the contract carries no other category fields. */
  emoji: string;
  /** Current streak (daily: days; weekly: target-met weeks). */
  streak: number;
  /** Longest streak anywhere in history. */
  bestStreak: number;
  /** Completion % 0-100 over the last 28 days (weekly: last 4 ISO weeks). */
  last28: number;
}

/** GET /stats. totalCheckins counts habit check-ins only (not tasks). */
export interface StatsResponse {
  dayStreak: number;
  totalCheckins: number;
  xpTotal: number;
  level: number;
  habits: StatsHabit[];
}

/**
 * GET /history entry — Done History (v1.2): one done-click, either a habit
 * check-in or a task completion. Names come from a live join, so renames
 * rewrite old entries and deletes erase them (accepted v1.2 limitations).
 */
export interface HistoryEntry {
  id: string;
  kind: 'checkin' | 'completion';
  name: string;
  /** YYYY-MM-DD in the user's timezone — group by this, NOT browser-local. */
  localDate: string;
  createdAt: string;
}

/** GET /history?limit= (default + cap 2000) → newest createdAt first. */
export interface HistoryResponse {
  entries: HistoryEntry[];
}

/** Dump item (UI name) — DB/API keep "inbox". */
export interface InboxItem {
  id: string;
  text: string;
  sourceUrl: string | null;
  status: 'open' | 'converted' | 'discarded';
  habitId: string | null;
  taskId: string | null;
  /** Optional answer captured at discard time; discards only. */
  discardNote: string | null;
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

/**
 * POST /inbox/:id/convert-task body — same rules as TaskInput (dueDate XOR
 * intervalHours); sourceUrl carries over from the dump item, never from the
 * client. Notes default server-side to the item text.
 */
export interface ConvertTaskInput {
  name: string;
  notes?: string;
  dueDate?: string;
  intervalHours?: number;
}

/** POST /inbox/:id/convert-task response. */
export interface ConvertTaskResponse {
  item: InboxItem;
  task: TaskItem;
  unlockedAchievements: Achievement[];
}
