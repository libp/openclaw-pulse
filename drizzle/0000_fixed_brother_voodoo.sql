CREATE TABLE `snapshots` (
	`captured_on` text PRIMARY KEY NOT NULL,
	`captured_at` text NOT NULL,
	`issue_open` integer NOT NULL,
	`issue_closed` integer NOT NULL,
	`pr_open` integer NOT NULL,
	`pr_closed` integer NOT NULL,
	`workflow_runs` integer,
	`source` text DEFAULT 'github-api' NOT NULL,
	`approximate_date` integer DEFAULT false NOT NULL
);
