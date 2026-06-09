import { pgTable, uuid, text, integer, timestamp, jsonb, time } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('Europe/Berlin'),
  xpTotal: integer('xp_total').notNull().default(0),
  nudgeTime: time('nudge_time'),
  pushSubscription: jsonb('push_subscription'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
