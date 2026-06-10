import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { inboxItems } from '../db/schema.js';
import type { InboxItem } from '../db/schema.js';
import { localDateFor } from '../game/dates.js';
import { levelFromXp } from '../game/xp.js';
import { awardAchievements, lockUserRow } from '../game/rewards.js';
import type { UnlockedAchievement } from '../game/rewards.js';
import { HttpError } from '../errors.js';
import { createHabit } from '../habits/service.js';
import type { CreateHabitInput, HabitContract } from '../habits/service.js';
import { createTask } from '../tasks/service.js';
import type { CreateTaskInput, TaskItemContract } from '../tasks/service.js';

/** Shared API contract shape (plan: "Shared API contracts"). */
export interface InboxItemContract {
  id: string;
  text: string;
  sourceUrl: string | null;
  status: 'open' | 'converted' | 'discarded';
  habitId: string | null;
  taskId: string | null;
  createdAt: string;
}

export interface CaptureInput {
  text: string;
  sourceUrl?: string;
}

/** Convert body — sourceUrl is never client-supplied, it carries over from the item. */
export type ConvertInput = Omit<CreateHabitInput, 'sourceUrl'>;

export interface ConvertResult {
  item: InboxItemContract;
  habit: HabitContract;
  unlockedAchievements: UnlockedAchievement[];
}

/** Convert-task body — same sourceUrl rule as the habit convert. */
export type ConvertTaskInput = Omit<CreateTaskInput, 'sourceUrl'>;

export interface ConvertTaskResult {
  item: InboxItemContract;
  task: TaskItemContract;
  unlockedAchievements: UnlockedAchievement[];
}

const notFound = () => new HttpError(404, 'not_found', 'Inbox item not found');
const alreadyTriaged = () =>
  new HttpError(409, 'already_triaged', 'Inbox item was already converted or discarded');

function toContract(item: InboxItem): InboxItemContract {
  return {
    id: item.id,
    text: item.text,
    sourceUrl: item.sourceUrl,
    status: item.status,
    habitId: item.habitId,
    taskId: item.taskId, // set by convert-task (Task 27); null until then
    createdAt: item.createdAt.toISOString(),
  };
}

export async function captureItem(
  userId: string,
  input: CaptureInput,
): Promise<InboxItemContract> {
  const [created] = await db
    .insert(inboxItems)
    .values({ userId, text: input.text, sourceUrl: input.sourceUrl ?? null })
    .returning();
  return toContract(created!);
}

/** Own items, newest first. Default = open only; `all` includes converted + discarded. */
export async function listItems(userId: string, all: boolean): Promise<InboxItemContract[]> {
  const filters = [eq(inboxItems.userId, userId)];
  if (!all) filters.push(eq(inboxItems.status, 'open'));
  const rows = await db
    .select()
    .from(inboxItems)
    .where(and(...filters))
    // id tiebreaker: same-timestamp captures (burst inserts) keep a stable order.
    .orderBy(desc(inboxItems.createdAt), desc(inboxItems.id));
  return rows.map(toContract);
}

export async function convertItem(
  userId: string,
  itemId: string,
  input: ConvertInput,
): Promise<ConvertResult> {
  return db.transaction(async (tx) => {
    // Row lock FIRST (rewards.ts lockUserRow comment explains why): the
    // conversions count and achievement thresholds below can't race a
    // parallel convert or check-in — each threshold fires exactly once.
    const user = await lockUserRow(tx, userId);

    const [item] = await tx
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.id, itemId), eq(inboxItems.userId, userId)));
    if (!item) throw notFound();
    if (item.status !== 'open') throw alreadyTriaged();

    // Habit creation rides the EXISTING service path (category-usable check,
    // weekly-target rules) inside THIS transaction — a failure rolls the
    // whole conversion back.
    const habit = await createHabit(
      userId,
      {
        ...input,
        notes: input.notes ?? item.text, // the dump text stays attached as the "why"
        sourceUrl: item.sourceUrl ?? undefined,
      },
      tx,
    );

    // status='open' predicate keeps the transition atomic even against a
    // concurrent discard (which runs outside this lock): losing the race
    // matches 0 rows → 409, rolling back the habit insert above.
    const [updated] = await tx
      .update(inboxItems)
      .set({ status: 'converted', habitId: habit.id })
      .where(and(eq(inboxItems.id, item.id), eq(inboxItems.status, 'open')))
      .returning();
    if (!updated) throw alreadyTriaged();

    // Conversion grants no XP, so level comes straight from the locked row.
    const unlockedAchievements: UnlockedAchievement[] = await awardAchievements(tx, userId, {
      today: localDateFor(user.timezone),
      level: levelFromXp(user.xpTotal),
    });
    return { item: toContract(updated), habit, unlockedAchievements };
  });
}

/**
 * Triage a dump item into a one-off or recurring task (Task 27). Mirrors
 * convertItem above exactly — same lock-first transaction, same 404/409
 * semantics, same notes/sourceUrl carry-over, same achievement context (the
 * conversions count treats habit and task conversions identically because it
 * only looks at status='converted').
 */
export async function convertItemToTask(
  userId: string,
  itemId: string,
  input: ConvertTaskInput,
): Promise<ConvertTaskResult> {
  return db.transaction(async (tx) => {
    // Row lock FIRST (rewards.ts lockUserRow comment explains why).
    const user = await lockUserRow(tx, userId);

    const [item] = await tx
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.id, itemId), eq(inboxItems.userId, userId)));
    if (!item) throw notFound();
    if (item.status !== 'open') throw alreadyTriaged();

    // Task creation rides the EXISTING service path inside THIS transaction.
    const task = await createTask(
      userId,
      {
        ...input,
        notes: input.notes ?? item.text, // the dump text stays attached as the "why"
        sourceUrl: item.sourceUrl ?? undefined,
      },
      tx,
    );

    // status='open' predicate: same concurrent-discard race guard as convertItem.
    const [updated] = await tx
      .update(inboxItems)
      .set({ status: 'converted', taskId: task.id }) // habitId stays null
      .where(and(eq(inboxItems.id, item.id), eq(inboxItems.status, 'open')))
      .returning();
    if (!updated) throw alreadyTriaged();

    // Conversion grants no XP, so level comes straight from the locked row.
    const unlockedAchievements: UnlockedAchievement[] = await awardAchievements(tx, userId, {
      today: localDateFor(user.timezone),
      level: levelFromXp(user.xpTotal),
    });
    return { item: toContract(updated), task, unlockedAchievements };
  });
}

/** Discard is allowed only from 'open' — the conditional update makes it atomic. */
export async function discardItem(userId: string, itemId: string): Promise<InboxItemContract> {
  const [updated] = await db
    .update(inboxItems)
    .set({ status: 'discarded' })
    .where(
      and(
        eq(inboxItems.id, itemId),
        eq(inboxItems.userId, userId),
        eq(inboxItems.status, 'open'),
      ),
    )
    .returning();
  if (updated) return toContract(updated);

  // Nothing matched: distinguish "not yours / missing" (404) from "already triaged" (409).
  const [existing] = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(and(eq(inboxItems.id, itemId), eq(inboxItems.userId, userId)));
  if (existing) throw alreadyTriaged();
  throw notFound();
}
