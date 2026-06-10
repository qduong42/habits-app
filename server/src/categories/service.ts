import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories } from '../db/schema.js';
import type { Category } from '../db/schema.js';
import { HttpError } from '../errors.js';

/** Shared API contract shape (plan: "Shared API contracts"). */
export interface CategoryContract {
  id: string;
  name: string;
  emoji: string;
  color: string;
  builtin: boolean;
}

export interface CreateCategoryInput {
  name: string;
  emoji: string;
  color: string;
}

/** Exported: the habit contract embeds a category (habits/service.ts). */
export function toCategoryContract(category: Category): CategoryContract {
  return {
    id: category.id,
    name: category.name,
    emoji: category.emoji,
    color: category.color,
    builtin: category.userId === null,
  };
}

/** Rows visible to a user: builtins (userId null) + their own customs. */
const visibleTo = (userId: string) =>
  or(isNull(categories.userId), eq(categories.userId, userId));

export async function listCategories(userId: string): Promise<CategoryContract[]> {
  const rows = await db
    .select()
    .from(categories)
    .where(visibleTo(userId))
    // Builtins first (false sorts before true ascending), then by name —
    // stable order for the category select in the UI.
    .orderBy(sql`${categories.userId} is not null`, categories.name);
  return rows.map(toCategoryContract);
}

export async function createCategory(
  userId: string,
  input: CreateCategoryInput,
): Promise<CategoryContract> {
  // App-level duplicate check (plan: no schema change at this scale):
  // case-insensitive against builtins and the user's own customs only —
  // other users' customs are invisible and don't clash.
  const [clash] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(visibleTo(userId), sql`lower(${categories.name}) = lower(${input.name})`));
  if (clash) {
    throw new HttpError(409, 'duplicate', 'A category with this name already exists');
  }

  const [created] = await db
    .insert(categories)
    .values({ userId, name: input.name, emoji: input.emoji, color: input.color })
    .returning();
  return toCategoryContract(created!);
}
