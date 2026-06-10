/**
 * Fixed achievement catalog + pure unlock checker (no I/O).
 * The catalog here is the single source of truth for slugs/metadata —
 * the DB seed imports it.
 */

export interface AchievementContext {
  totalCheckins: number;
  habitStreak: number;
  dayStreak: number;
  level: number;
  conversions: number; // dump items converted into a habit OR a task
  categoriesToday: number; // distinct categories checked in today
  unlocked: Set<string>;
}

type Metric = keyof Omit<AchievementContext, 'unlocked'>;

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  emoji: string;
  metric: Metric;
  threshold: number;
}

export const ACHIEVEMENT_CATALOG: readonly AchievementDef[] = [
  { id: 'first-checkin', name: 'First Step', emoji: '🎉',
    description: 'Complete your very first check-in.',
    metric: 'totalCheckins', threshold: 1 },
  { id: 'checkins-100', name: 'Century Club', emoji: '💯',
    description: 'Rack up 100 total check-ins.',
    metric: 'totalCheckins', threshold: 100 },
  { id: 'checkins-1000', name: 'Mountain Mover', emoji: '🏔',
    description: 'Rack up 1000 total check-ins.',
    metric: 'totalCheckins', threshold: 1000 },
  { id: 'habit-streak-7', name: 'On Fire', emoji: '🔥',
    description: 'Keep a 7-day streak on a single habit.',
    metric: 'habitStreak', threshold: 7 },
  { id: 'habit-streak-30', name: 'Unstoppable', emoji: '⚡',
    description: 'Keep a 30-day streak on a single habit.',
    metric: 'habitStreak', threshold: 30 },
  { id: 'habit-streak-100', name: 'Shining Star', emoji: '🌟',
    description: 'Keep a 100-day streak on a single habit.',
    metric: 'habitStreak', threshold: 100 },
  { id: 'day-streak-7', name: 'Full Week', emoji: '📅',
    description: 'Check in at least once a day for 7 days in a row.',
    metric: 'dayStreak', threshold: 7 },
  { id: 'day-streak-30', name: 'Habitual', emoji: '🗓',
    description: 'Check in at least once a day for 30 days in a row.',
    metric: 'dayStreak', threshold: 30 },
  { id: 'level-5', name: 'Bronze League', emoji: '🥉',
    description: 'Reach level 5.',
    metric: 'level', threshold: 5 },
  { id: 'level-10', name: 'Gold League', emoji: '🥇',
    description: 'Reach level 10.',
    metric: 'level', threshold: 10 },
  { id: 'first-conversion', name: 'Bright Idea', emoji: '💡',
    description: 'Turn your first dump item into a habit or task.',
    metric: 'conversions', threshold: 1 },
  { id: 'conversions-5', name: 'Idea Collector', emoji: '📚',
    description: 'Turn 5 dump items into habits or tasks.',
    metric: 'conversions', threshold: 5 },
  { id: 'conversions-25', name: 'Idea Lab', emoji: '🧪',
    description: 'Turn 25 dump items into habits or tasks.',
    metric: 'conversions', threshold: 25 },
  { id: 'balanced-day', name: 'Balanced Day', emoji: '⚖️',
    description: 'Check in across 3 or more categories on one day.',
    metric: 'categoriesToday', threshold: 3 },
];

/**
 * Returns the ids newly unlocked by `ctx` — entries whose metric meets its
 * threshold and that aren't in `ctx.unlocked` yet. Catalog order, so the
 * result is deterministic.
 */
export function checkAchievements(ctx: AchievementContext): string[] {
  return ACHIEVEMENT_CATALOG.filter(
    (a) => !ctx.unlocked.has(a.id) && ctx[a.metric] >= a.threshold,
  ).map((a) => a.id);
}
