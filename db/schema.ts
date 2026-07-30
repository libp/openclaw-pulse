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

// 细粒度主存储:每次采集一行(不去重),支持日内历史与按日聚合。
// 历史种子点的 stars/forks/commits/contributors 等为 null(GitHub API 不给历史时点)。
export const metricPoints = sqliteTable("metric_points", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  capturedAt: text("captured_at").notNull(),
  capturedOn: text("captured_on").notNull(),
  issueOpen: integer("issue_open").notNull(),
  issueClosed: integer("issue_closed").notNull(),
  prOpen: integer("pr_open").notNull(),
  prClosed: integer("pr_closed").notNull(),
  prMerged: integer("pr_merged"),
  workflowRuns: integer("workflow_runs"),
  stars: integer("stars"),
  forks: integer("forks"),
  subscribers: integer("subscribers"),
  commits: integer("commits"),
  contributors: integer("contributors"),
  source: text("source").notNull().default("github-api"),
});
