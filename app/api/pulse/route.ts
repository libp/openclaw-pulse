export const runtime = "edge";

export type PulseDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<unknown>;
    };
    first<T>(): Promise<T | null>;
    all(): Promise<{ results: Record<string, unknown>[] }>;
  };
  batch(statements: unknown[]): Promise<unknown>;
};

const REPO = "openclaw/openclaw";
const GITHUB_API = "https://api.github.com";
const ARCHIVE_URL =
  "https://raw.githubusercontent.com/libp/openclaw-pulse/main/public/data/pulse.json";

type Snapshot = {
  capturedOn: string;
  capturedAt: string;
  issueOpen: number;
  issueClosed: number;
  prOpen: number;
  prClosed: number;
  workflowRuns: number | null;
  source: string;
  approximateDate: boolean;
};

const seedSnapshots: Snapshot[] = [
  {
    capturedOn: "2026-03-01",
    capturedAt: "2026-03-01T00:00:00.000Z",
    issueOpen: 6480,
    issueClosed: 10686,
    prOpen: 5493,
    prClosed: 17907,
    workflowRuns: 521903,
    source: "manual-post",
    approximateDate: true,
  },
  {
    capturedOn: "2026-06-14",
    capturedAt: "2026-06-14T00:00:00.000Z",
    issueOpen: 3934,
    issueClosed: 35875,
    prOpen: 3611,
    prClosed: 47253,
    workflowRuns: null,
    source: "manual-post",
    approximateDate: false,
  },
  {
    capturedOn: "2026-07-12",
    capturedAt: "2026-07-12T00:00:00.000Z",
    issueOpen: 3578,
    issueClosed: 39154,
    prOpen: 2777,
    prClosed: 57051,
    workflowRuns: null,
    source: "manual-post",
    approximateDate: false,
  },
];

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "OpenClaw-Pulse",
  };
}

async function githubJson(url: string) {
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}`);
  }
  return response.json() as Promise<Record<string, unknown> | unknown[]>;
}

async function searchCount(query: string) {
  const data = (await githubJson(
    `${GITHUB_API}/search/issues?q=${encodeURIComponent(`repo:${REPO} ${query}`)}&per_page=1`,
  )) as { total_count?: number };
  if (typeof data.total_count !== "number") {
    throw new Error("GitHub count missing");
  }
  return data.total_count;
}

async function fetchSnapshot(): Promise<Snapshot> {
  const [issueOpen, issueClosed, prOpen, prClosed, runs] = await Promise.all([
    searchCount("is:issue is:open"),
    searchCount("is:issue is:closed"),
    searchCount("is:pr is:open"),
    searchCount("is:pr is:closed"),
    githubJson(`${GITHUB_API}/repos/${REPO}/actions/runs?per_page=1`),
  ]);
  const now = new Date();
  return {
    capturedOn: now.toISOString().slice(0, 10),
    capturedAt: now.toISOString(),
    issueOpen,
    issueClosed,
    prOpen,
    prClosed,
    workflowRuns:
      typeof (runs as { total_count?: number }).total_count === "number"
        ? (runs as { total_count: number }).total_count
        : null,
    source: "github-api",
    approximateDate: false,
  };
}

type GitHubItem = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  updated_at: string;
  user?: { login?: string };
  pull_request?: unknown;
};

type PulseArchive = {
  repository: string;
  generatedAt: string;
  snapshots: Snapshot[];
  activity: Awaited<ReturnType<typeof fetchActivity>>;
};

async function fetchArchive(): Promise<PulseArchive> {
  const cacheWindow = Math.floor(Date.now() / 300000);
  const response = await fetch(`${ARCHIVE_URL}?v=${cacheWindow}`, {
    headers: { Accept: "application/json", "User-Agent": "OpenClaw-Pulse" },
  });
  if (!response.ok) throw new Error(`Archive ${response.status}`);
  const archive = (await response.json()) as PulseArchive;
  if (!Array.isArray(archive.snapshots) || !archive.snapshots.length) {
    throw new Error("Archive snapshots missing");
  }
  return archive;
}

async function fetchActivity() {
  const [issuesRaw, pullsRaw] = await Promise.all([
    githubJson(
      `${GITHUB_API}/repos/${REPO}/issues?state=all&sort=updated&direction=desc&per_page=20`,
    ),
    githubJson(
      `${GITHUB_API}/repos/${REPO}/pulls?state=all&sort=updated&direction=desc&per_page=8`,
    ),
  ]);
  const shape = (item: GitHubItem, kind: "issue" | "pr") => ({
    kind,
    number: item.number,
    title: item.title,
    url: item.html_url,
    state: item.state,
    author: item.user?.login ?? "unknown",
    updatedAt: item.updated_at,
  });
  const issues = (issuesRaw as GitHubItem[])
    .filter((item) => !item.pull_request)
    .slice(0, 6)
    .map((item) => shape(item, "issue"));
  const prs = (pullsRaw as GitHubItem[])
    .slice(0, 6)
    .map((item) => shape(item, "pr"));
  return { issues, prs };
}

async function readAndRefreshSnapshots(db: PulseDatabase) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS snapshots (
      captured_on TEXT PRIMARY KEY,
      captured_at TEXT NOT NULL,
      issue_open INTEGER NOT NULL,
      issue_closed INTEGER NOT NULL,
      pr_open INTEGER NOT NULL,
      pr_closed INTEGER NOT NULL,
      workflow_runs INTEGER,
      source TEXT NOT NULL DEFAULT 'github-api',
      approximate_date INTEGER NOT NULL DEFAULT 0
    )`),
    ...seedSnapshots.map((item) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO snapshots
          (captured_on, captured_at, issue_open, issue_closed, pr_open, pr_closed, workflow_runs, source, approximate_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          item.capturedOn,
          item.capturedAt,
          item.issueOpen,
          item.issueClosed,
          item.prOpen,
          item.prClosed,
          item.workflowRuns,
          item.source,
          item.approximateDate ? 1 : 0,
        ),
    ),
  ]);

  const latest = await db
    .prepare("SELECT captured_at FROM snapshots ORDER BY captured_at DESC LIMIT 1")
    .first<{ captured_at: string }>();
  const stale =
    !latest || Date.now() - new Date(latest.captured_at).getTime() > 60 * 60 * 1000;

  if (stale) {
    try {
      const fresh = await fetchSnapshot();
      await db
        .prepare(
          `INSERT INTO snapshots
          (captured_on, captured_at, issue_open, issue_closed, pr_open, pr_closed, workflow_runs, source, approximate_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(captured_on) DO UPDATE SET
            captured_at = excluded.captured_at,
            issue_open = excluded.issue_open,
            issue_closed = excluded.issue_closed,
            pr_open = excluded.pr_open,
            pr_closed = excluded.pr_closed,
            workflow_runs = excluded.workflow_runs,
            source = excluded.source`,
        )
        .bind(
          fresh.capturedOn,
          fresh.capturedAt,
          fresh.issueOpen,
          fresh.issueClosed,
          fresh.prOpen,
          fresh.prClosed,
          fresh.workflowRuns,
          fresh.source,
        )
        .run();
    } catch {
      // Historical data remains usable when GitHub is temporarily rate limited.
    }
  }

  const result = await db
    .prepare(
      `SELECT captured_on, captured_at, issue_open, issue_closed,
       pr_open, pr_closed, workflow_runs, source, approximate_date
       FROM snapshots ORDER BY captured_on ASC`,
    )
    .all();
  return result.results.map((row: Record<string, unknown>) => ({
    capturedOn: String(row.captured_on),
    capturedAt: String(row.captured_at),
    issueOpen: Number(row.issue_open),
    issueClosed: Number(row.issue_closed),
    prOpen: Number(row.pr_open),
    prClosed: Number(row.pr_closed),
    workflowRuns:
      row.workflow_runs === null || row.workflow_runs === undefined
        ? null
        : Number(row.workflow_runs),
    source: String(row.source),
    approximateDate: Boolean(row.approximate_date),
  }));
}

export async function handlePulse(db?: PulseDatabase) {
  try {
    const archive = await fetchArchive();
    return Response.json(archive, {
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
    });
  } catch {
    // Continue with the D1/live fallback if GitHub's raw archive is unavailable.
  }

  let snapshots = seedSnapshots;
  if (db) {
    try {
      snapshots = await readAndRefreshSnapshots(db);
    } catch {
      // Fall through to the live, non-persistent path.
    }
  }

  if (!db || snapshots === seedSnapshots) {
    try {
      const fresh = await fetchSnapshot();
      snapshots = [...seedSnapshots.filter((item) => item.capturedOn !== fresh.capturedOn), fresh];
    } catch {
      // Static seed is an intentional offline fallback.
    }
  }

  let activity = { issues: [], prs: [] } as Awaited<ReturnType<typeof fetchActivity>>;
  try {
    activity = await fetchActivity();
  } catch {
    // The dashboard can still render metrics during a GitHub API outage.
  }

  return Response.json(
    { repository: REPO, snapshots, activity },
    { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } },
  );
}

export async function GET() {
  return handlePulse();
}
