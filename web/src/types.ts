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
