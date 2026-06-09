import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  time,
  date,
  unique,
  primaryKey,
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
  (t) => [unique('uniq_checkin_per_day').on(t.habitId, t.localDate)],
);

export type Checkin = typeof checkins.$inferSelect;

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
