import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const snapshots = sqliteTable("snapshots", {
  capturedOn: text("captured_on").primaryKey(),
  capturedAt: text("captured_at").notNull(),
  issueOpen: integer("issue_open").notNull(),
  issueClosed: integer("issue_closed").notNull(),
  prOpen: integer("pr_open").notNull(),
  prClosed: integer("pr_closed").notNull(),
  workflowRuns: integer("workflow_runs"),
  source: text("source").notNull().default("github-api"),
  approximateDate: integer("approximate_date", { mode: "boolean" })
    .notNull()
    .default(false),
});
