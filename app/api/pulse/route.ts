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
  prMerged: number | null;
  workflowRuns: number | null;
  stars: number | null;
  forks: number | null;
  subscribers: number | null;
  commits: number | null;
  contributors: number | null;
  source: string;
  approximateDate: boolean;
};

type MetricPoint = {
  capturedOn: string;
  stars: number | null;
  forks: number | null;
  subscribers: number | null;
  commits: number | null;
  contributors: number | null;
};

// 历史种子点:GitHub API 不给历史时点,仓库规模字段为 null。日期已核实(2026-03-10)。
const seedSnapshots: Snapshot[] = [
  {
    capturedOn: "2026-03-10",
    capturedAt: "2026-03-10T00:00:00.000Z",
    issueOpen: 6480, issueClosed: 10686, prOpen: 5493, prClosed: 17907,
    prMerged: null, workflowRuns: 521903,
    stars: null, forks: null, subscribers: null, commits: null, contributors: null,
    source: "manual-post", approximateDate: false,
  },
  {
    capturedOn: "2026-06-14",
    capturedAt: "2026-06-14T00:00:00.000Z",
    issueOpen: 3934, issueClosed: 35875, prOpen: 3611, prClosed: 47253,
    prMerged: null, workflowRuns: null,
    stars: null, forks: null, subscribers: null, commits: null, contributors: null,
    source: "manual-post", approximateDate: false,
  },
  {
    capturedOn: "2026-07-12",
    capturedAt: "2026-07-12T00:00:00.000Z",
    issueOpen: 3578, issueClosed: 39154, prOpen: 2777, prClosed: 57051,
    prMerged: null, workflowRuns: null,
    stars: null, forks: null, subscribers: null, commits: null, contributors: null,
    source: "manual-post", approximateDate: false,
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

// commits/contributors 无 total_count:用 per_page=1 + link header 的 last page 推总数。
async function countViaLastPage(url: string): Promise<number | null> {
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) return null;
  const link = response.headers.get("link") || "";
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

const numOrNull = (v: unknown) => (typeof v === "number" ? v : null);

async function fetchSnapshot(): Promise<Snapshot> {
  const [issueOpen, issueClosed, prOpen, prClosed, prMerged, runs, repoInfo, commitCount, contributorCount] =
    await Promise.all([
      searchCount("is:issue is:open"),
      searchCount("is:issue is:closed"),
      searchCount("is:pr is:open"),
      searchCount("is:pr is:closed"),
      searchCount("is:pr is:merged"),
      githubJson(`${GITHUB_API}/repos/${REPO}/actions/runs?per_page=1`),
      githubJson(`${GITHUB_API}/repos/${REPO}`),
      countViaLastPage(`${GITHUB_API}/repos/${REPO}/commits?per_page=1`),
      countViaLastPage(`${GITHUB_API}/repos/${REPO}/contributors?per_page=1&anon=true`),
    ]);
  const now = new Date();
  const repo = repoInfo as Record<string, unknown>;
  return {
    capturedOn: now.toISOString().slice(0, 10),
    capturedAt: now.toISOString(),
    issueOpen,
    issueClosed,
    prOpen,
    prClosed,
    prMerged,
    workflowRuns: numOrNull((runs as { total_count?: number }).total_count),
    stars: numOrNull(repo.stargazers_count),
    forks: numOrNull(repo.forks_count),
    subscribers: numOrNull(repo.subscribers_count),
    commits: commitCount,
    contributors: contributorCount,
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
  metrics?: MetricPoint[];
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

const METRIC_COLUMNS =
  "captured_at, captured_on, issue_open, issue_closed, pr_open, pr_closed, pr_merged, workflow_runs, stars, forks, subscribers, commits, contributors, source";

type Bound = { run(): Promise<unknown> };

function bindSnapshot(
  stmt: { bind(...values: unknown[]): Bound },
  s: Snapshot,
): Bound {
  return stmt.bind(
    s.capturedAt, s.capturedOn, s.issueOpen, s.issueClosed, s.prOpen, s.prClosed, s.prMerged,
    s.workflowRuns, s.stars, s.forks, s.subscribers, s.commits, s.contributors, s.source,
  );
}

function mapRow(row: Record<string, unknown>): Snapshot {
  const num = (v: unknown) =>
    v === null || v === undefined ? null : Number(v);
  return {
    capturedOn: String(row.captured_on),
    capturedAt: String(row.captured_at),
    issueOpen: Number(row.issue_open),
    issueClosed: Number(row.issue_closed),
    prOpen: Number(row.pr_open),
    prClosed: Number(row.pr_closed),
    prMerged: num(row.pr_merged),
    workflowRuns: num(row.workflow_runs),
    stars: num(row.stars),
    forks: num(row.forks),
    subscribers: num(row.subscribers),
    commits: num(row.commits),
    contributors: num(row.contributors),
    source: String(row.source),
    approximateDate: false,
  };
}

function toMetricPoint(s: Snapshot): MetricPoint {
  return {
    capturedOn: s.capturedOn,
    stars: s.stars,
    forks: s.forks,
    subscribers: s.subscribers,
    commits: s.commits,
    contributors: s.contributors,
  };
}

// D1 主存储:细粒度(每次采集一行),按日聚合读取。仅在表空时写入历史种子。
async function readAndRefreshMetricPoints(db: PulseDatabase): Promise<Snapshot[]> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS metric_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      captured_on TEXT NOT NULL,
      issue_open INTEGER NOT NULL,
      issue_closed INTEGER NOT NULL,
      pr_open INTEGER NOT NULL,
      pr_closed INTEGER NOT NULL,
      pr_merged INTEGER,
      workflow_runs INTEGER,
      stars INTEGER,
      forks INTEGER,
      subscribers INTEGER,
      commits INTEGER,
      contributors INTEGER,
      source TEXT NOT NULL DEFAULT 'github-api'
    )`),
  ]);

  const countRow = await db
    .prepare("SELECT COUNT(*) AS c FROM metric_points")
    .first<{ c: number }>();
  if ((countRow?.c ?? 0) === 0) {
    await db.batch(
      seedSnapshots.map((item) =>
        bindSnapshot(
          db.prepare(
            `INSERT INTO metric_points (${METRIC_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ),
          item,
        ),
      ),
    );
  }

  const latest = await db
    .prepare("SELECT captured_at FROM metric_points ORDER BY captured_at DESC LIMIT 1")
    .first<{ captured_at: string }>();
  const stale =
    !latest || Date.now() - new Date(latest.captured_at).getTime() > 60 * 60 * 1000;

  if (stale) {
    try {
      const fresh = await fetchSnapshot();
      await bindSnapshot(
        db.prepare(
          `INSERT INTO metric_points (${METRIC_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ),
        fresh,
      ).run();
    } catch {
      // Historical data remains usable when GitHub is temporarily rate limited.
    }
  }

  const result = await db
    .prepare(
      `SELECT ${METRIC_COLUMNS} FROM metric_points
       WHERE id IN (SELECT MAX(id) FROM metric_points GROUP BY captured_on)
       ORDER BY captured_on ASC`,
    )
    .all();
  return result.results.map((row: Record<string, unknown>) => mapRow(row));
}

export async function handlePulse(db?: PulseDatabase) {
  const cache = { "Cache-Control": "public, max-age=300, s-maxage=300" };

  // 1. D1 主存储(优先):细粒度采集、按日聚合、stale 时自采。
  if (db) {
    try {
      const snapshots = await readAndRefreshMetricPoints(db);
      const metrics = snapshots.map(toMetricPoint);
      let activity = { issues: [], prs: [] } as Awaited<ReturnType<typeof fetchActivity>>;
      try {
        activity = await fetchActivity();
      } catch {
        // Activity is best-effort during a GitHub API outage.
      }
      return Response.json({ repository: REPO, snapshots, metrics, activity }, { headers: cache });
    } catch {
      // Fall through to archive/live fallback if D1 is unavailable.
    }
  }

  // 2. archive 兜底(GitHub raw pulse.json,CI 维护的公开数据)。
  try {
    const archive = await fetchArchive();
    return Response.json(archive, { headers: cache });
  } catch {
    // Continue to the live, non-persistent path.
  }

  // 3. live + seed(完全离线兜底)。
  let snapshots = seedSnapshots;
  try {
    const fresh = await fetchSnapshot();
    snapshots = [...seedSnapshots.filter((item) => item.capturedOn !== fresh.capturedOn), fresh];
  } catch {
    // Static seed is an intentional offline fallback.
  }
  const metrics = snapshots.map(toMetricPoint);
  let activity = { issues: [], prs: [] } as Awaited<ReturnType<typeof fetchActivity>>;
  try {
    activity = await fetchActivity();
  } catch {
    // The dashboard can still render metrics during a GitHub API outage.
  }

  return Response.json({ repository: REPO, snapshots, metrics, activity }, { headers: cache });
}

export async function GET() {
  return handlePulse();
}
