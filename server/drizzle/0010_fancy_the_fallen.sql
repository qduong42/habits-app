ALTER TABLE "checkins" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "task_completions" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_note" text;