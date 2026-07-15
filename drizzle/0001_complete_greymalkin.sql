CREATE TABLE `metric_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`captured_at` text NOT NULL,
	`captured_on` text NOT NULL,
	`issue_open` integer NOT NULL,
	`issue_closed` integer NOT NULL,
	`pr_open` integer NOT NULL,
	`pr_closed` integer NOT NULL,
	`pr_merged` integer,
	`workflow_runs` integer,
	`stars` integer,
	`forks` integer,
	`subscribers` integer,
	`commits` integer,
	`contributors` integer,
	`source` text DEFAULT 'github-api' NOT NULL
);
