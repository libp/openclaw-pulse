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

async function collect() {
  const [issueOpen, issueClosed, prOpen, prClosed, runs, issuesRaw, prsRaw] =
    await Promise.all([
      searchCount("is:issue is:open"),
      searchCount("is:issue is:closed"),
      searchCount("is:pr is:open"),
      searchCount("is:pr is:closed"),
      github(`/repos/${targetRepo}/actions/runs?per_page=1`),
      github(`/repos/${targetRepo}/issues?state=all&sort=updated&direction=desc&per_page=20`),
      github(`/repos/${targetRepo}/pulls?state=all&sort=updated&direction=desc&per_page=8`),
    ]);

  const now = new Date();
  const snapshot = {
    capturedOn: now.toISOString().slice(0, 10),
    capturedAt: now.toISOString(),
    issueOpen,
    issueClosed,
    prOpen,
    prClosed,
    workflowRuns: typeof runs.total_count === "number" ? runs.total_count : null,
    source: "github-actions",
    approximateDate: false,
  };

  let previous = { repository: targetRepo, generatedAt: null, snapshots: [], activity: { issues: [], prs: [] } };
  try {
    previous = JSON.parse(await readFile(outputPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const snapshots = previous.snapshots
    .filter((item) => item.capturedOn !== snapshot.capturedOn)
    .concat(snapshot)
    .sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  const activity = {
    issues: issuesRaw
      .filter((item) => !item.pull_request)
      .slice(0, 6)
      .map((item) => shapeActivity(item, "issue")),
    prs: prsRaw.slice(0, 6).map((item) => shapeActivity(item, "pr")),
  };

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ repository: targetRepo, generatedAt: now.toISOString(), snapshots, activity }, null, 2)}\n`,
  );
  console.log(`Recorded ${snapshot.capturedOn}: ${issueOpen} issues open, ${prOpen} PRs open`);
}

await collect();
