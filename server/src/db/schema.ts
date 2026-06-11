import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  jsonb,
  time,
  date,
  unique,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  xpTotal: integer('xp_total').notNull().default(0),
  nudgeTime: time('nudge_time'),
  pushSubscription: jsonb('push_subscription').$type<{
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id), // null = builtin preset
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  color: text('color').notNull(),
});

export type Category = typeof categories.$inferSelect;

export const habits = pgTable('habits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  categoryId: uuid('category_id').notNull().references(() => categories.id),
  name: text('name').notNull(),
  notes: text('notes'),
  sourceUrl: text('source_url'),
  frequencyType: text('frequency_type', { enum: ['daily', 'weekly'] }).notNull(),
  weeklyTarget: integer('weekly_target'),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Habit = typeof habits.$inferSelect;

export const checkins = pgTable(
  'checkins',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    habitId: uuid('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    localDate: date('local_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('uniq_checkin_per_day').on(t.habitId, t.localDate),
    // per-user date-bounded scans (push/nudge.ts currentWeekCheckins)
    index('idx_checkins_user_date').on(t.userId, t.localDate),
  ],
);

export type Checkin = typeof checkins.$inferSelect;

/**
 * Tasks have two shapes on one table (ADR-0001 — two time grains on purpose):
 * - one-off: `intervalHours` NULL; optional `dueDate` (user-TZ local date);
 *   `completedAt` is the terminal completion.
 * - recurring: `intervalHours` set (>= 1); `nextDue` = last completion +
 *   interval (creation time + interval initially); never terminal.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    notes: text('notes'),
    sourceUrl: text('source_url'),
    dueDate: date('due_date'), // one-off only, optional
    intervalHours: numeric('interval_hours', { mode: 'number' }), // set = recurring
    nextDue: timestamp('next_due', { withTimezone: true }), // recurring only
    completedAt: timestamp('completed_at', { withTimezone: true }), // one-off terminal
    remindAt: timestamp('remind_at', { withTimezone: true }), // one-off only, optional
    // Refire guard: stamped when the reminder push goes out (v1.2 spec §2);
    // cleared whenever remindAt changes.
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('idx_tasks_user_id').on(t.userId)],
);

export type Task = typeof tasks.$inferSelect;

// NO unique constraint on (task_id, local_date): sub-daily recurring tasks
// legitimately complete multiple times per local date (ADR-0001).
export const taskCompletions = pgTable(
  'task_completions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id),
    localDate: date('local_date').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // latest-completion-per-task lookups (listTasks DISTINCT ON, undo re-anchor)
  (t) => [index('idx_task_completions_task_created').on(t.taskId, t.createdAt)],
);

export type TaskCompletion = typeof taskCompletions.$inferSelect;

// UI name: "Dump" — DB/API keep the `inbox` naming (spec).
export const inboxItems = pgTable('inbox_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  text: text('text').notNull(),
  sourceUrl: text('source_url'),
  status: text('status', { enum: ['open', 'converted', 'discarded'] })
    .notNull()
    .default('open'),
  // Links clear on habit/task deletion; the item stays 'converted' so the dump
  // history survives.
  habitId: uuid('habit_id').references(() => habits.id, { onDelete: 'set null' }), // set when triaged into a habit
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }), // set when triaged into a task (Task 27 route)
  // Optional answer captured at discard time ("sasi teeth is ok?" → "yes,
  // dentist said fine"). Discards only — conversions never set it (v1.1).
  discardNote: text('discard_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type InboxItem = typeof inboxItems.$inferSelect;

export const achievements = pgTable('achievements', {
  id: text('id').primaryKey(), // slug, e.g. 'habit-streak-7'
  name: text('name').notNull(),
  description: text('description').notNull(),
  emoji: text('emoji').notNull(),
});

export type Achievement = typeof achievements.$inferSelect;

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id').notNull().references(() => users.id),
    achievementId: text('achievement_id')
      .notNull()
      .references(() => achievements.id),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

export type UserAchievement = typeof userAchievements.$inferSelect;
