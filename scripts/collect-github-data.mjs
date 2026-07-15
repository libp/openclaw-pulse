import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const targetRepo = process.env.TARGET_REPO || "openclaw/openclaw";
const token = process.env.GITHUB_TOKEN;
const outputPath = resolve("public/data/pulse.json");
const api = "https://api.github.com";

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "OpenClaw-Pulse-Collector",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function github(path) {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`GitHub API ${response.status}: ${message.slice(0, 300)}`);
  }
  return response.json();
}

async function searchCount(query) {
  const result = await github(
    `/search/issues?q=${encodeURIComponent(`repo:${targetRepo} ${query}`)}&per_page=1`,
  );
  if (typeof result.total_count !== "number") throw new Error(`Count missing: ${query}`);
  return result.total_count;
}

// GitHub 不给 commits/contributors 的 total_count;用 per_page=1 + link header 的 last page 推总数。
async function totalCountViaLastPage(path) {
  const response = await fetch(`${api}${path}`, { headers });
  if (!response.ok) return null;
  const link = response.headers.get("link") || "";
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? Number(match[1]) : null;
}

function shapeActivity(item, kind) {
  return {
    kind,
    number: item.number,
    title: item.title,
    url: item.html_url,
    state: item.state,
    author: item.user?.login || "unknown",
    updatedAt: item.updated_at,
  };
}

// 写一条细粒度记录到 D1(主存储)。无 CF 凭证时跳过(本地只更新 pulse.json)。
async function writeD1(point) {
  const { CF_API_TOKEN, CF_ACCOUNT_ID, D1_DATABASE_ID } = process.env;
  if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !D1_DATABASE_ID) return false;
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
  const sql = `INSERT INTO metric_points (captured_at, captured_on, issue_open, issue_closed, pr_open, pr_closed, pr_merged, workflow_runs, stars, forks, subscribers, commits, contributors, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    point.capturedAt, point.capturedOn,
    point.issueOpen, point.issueClosed, point.prOpen, point.prClosed, point.prMerged,
    point.workflowRuns, point.stars, point.forks, point.subscribers,
    point.commits, point.contributors, point.source,
  ];
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(`D1 insert failed: ${JSON.stringify(data.errors)}`);
  return true;
}

async function collect() {
  const [
    issueOpen, issueClosed, prOpen, prClosed, prMerged,
    runs, repoInfo, commitCount, contributorCount, issuesRaw, prsRaw,
  ] = await Promise.all([
    searchCount("is:issue is:open"),
    searchCount("is:issue is:closed"),
    searchCount("is:pr is:open"),
    searchCount("is:pr is:closed"),
    searchCount("is:pr is:merged"),
    github(`/repos/${targetRepo}/actions/runs?per_page=1`),
    github(`/repos/${targetRepo}`),
    totalCountViaLastPage(`/repos/${targetRepo}/commits?per_page=1`),
    totalCountViaLastPage(`/repos/${targetRepo}/contributors?per_page=1&anon=true`),
    github(`/repos/${targetRepo}/issues?state=all&sort=updated&direction=desc&per_page=20`),
    github(`/repos/${targetRepo}/pulls?state=all&sort=updated&direction=desc&per_page=8`),
  ]);

  const now = new Date();
  const capturedOn = now.toISOString().slice(0, 10);
  const capturedAt = now.toISOString();
  const snapshot = {
    capturedOn,
    capturedAt,
    issueOpen,
    issueClosed,
    prOpen,
    prClosed,
    prMerged,
    workflowRuns: typeof runs.total_count === "number" ? runs.total_count : null,
    stars: typeof repoInfo.stargazers_count === "number" ? repoInfo.stargazers_count : null,
    forks: typeof repoInfo.forks_count === "number" ? repoInfo.forks_count : null,
    subscribers: typeof repoInfo.subscribers_count === "number" ? repoInfo.subscribers_count : null,
    commits: commitCount,
    contributors: contributorCount,
    source: "github-actions",
    approximateDate: false,
  };

  let previous = { repository: targetRepo, generatedAt: null, snapshots: [], metrics: [], activity: { issues: [], prs: [] } };
  try {
    previous = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // pulse.json 作为 archive 兜底:snapshots 与 metrics 都按日去重(每天一个点)。
  const snapshots = (previous.snapshots || [])
    .filter((item) => item.capturedOn !== capturedOn)
    .concat(snapshot)
    .sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  const metricPoint = {
    capturedOn,
    stars: snapshot.stars,
    forks: snapshot.forks,
    subscribers: snapshot.subscribers,
    commits: snapshot.commits,
    contributors: snapshot.contributors,
  };
  const metrics = (previous.metrics || [])
    .filter((item) => item.capturedOn !== capturedOn)
    .concat(metricPoint)
    .sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  const activity = {
    issues: issuesRaw
      .filter((item) => !item.pull_request)
      .slice(0, 6)
      .map((item) => shapeActivity(item, "issue")),
    prs: prsRaw.slice(0, 6).map((item) => shapeActivity(item, "pr")),
  };

  // D1 写入(细粒度,不去重)。失败不中断 pulse.json 更新。
  let d1Written = false;
  try {
    d1Written = await writeD1(snapshot);
  } catch (error) {
    console.error(`D1 write skipped: ${error.message}`);
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ repository: targetRepo, generatedAt: capturedAt, snapshots, metrics, activity }, null, 2)}\n`,
  );
  console.log(`Recorded ${capturedOn}: ${issueOpen} issues open, ${prOpen} PRs open, ${snapshot.stars} stars${d1Written ? " [D1]" : ""}`);
}

await collect();
