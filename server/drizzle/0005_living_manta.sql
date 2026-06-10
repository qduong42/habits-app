ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_habit_id_habits_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" DROP CONSTRAINT "inbox_items_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_habit_id_habits_id_fk" FOREIGN KEY ("habit_id") REFERENCES "public"."habits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;