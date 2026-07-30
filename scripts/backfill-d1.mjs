import { readFile } from "node:fs/promises";

// 一次性回补:从 GitHub raw 上的 pulse.json archive(每小时由 CI 维护,按日去重)
// 把 D1 缺失的天数补进 metric_points。只补 D1 里还没有的 captured_on,且跳过历史种子
// (manual-post),避免与已有的种子点重复。幂等:重复运行不会产生重复行。
//
// 用法:
//   CF_API_TOKEN=... CF_ACCOUNT_ID=... D1_DATABASE_ID=... node scripts/backfill-d1.mjs

const ARCHIVE_URL =
  "https://raw.githubusercontent.com/libp/openclaw-pulse/main/public/data/pulse.json";

const { CF_API_TOKEN, CF_ACCOUNT_ID, D1_DATABASE_ID } = process.env;
if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !D1_DATABASE_ID) {
  console.error("Missing CF_API_TOKEN / CF_ACCOUNT_ID / D1_DATABASE_ID");
  process.exit(1);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
const headers = { Authorization: `Bearer ${CF_API_TOKEN}`, "Content-Type": "application/json" };

async function d1(sql, params = []) {
  const response = await fetch(base, {
    method: "POST",
    headers,
    body: JSON.stringify({ sql, params }),
  });
  const data = await response.json();
  if (!data.success) throw new Error(`D1 error: ${JSON.stringify(data.errors)}`);
  return data.result?.[0]?.results ?? [];
}

const COLUMNS =
  "captured_at, captured_on, issue_open, issue_closed, pr_open, pr_closed, pr_merged, workflow_runs, stars, forks, subscribers, commits, contributors, source";

async function main() {
  // 1. D1 已有的 captured_on(去重)。
  const existingRows = await d1("SELECT DISTINCT captured_on FROM metric_points");
  const existing = new Set(existingRows.map((row) => row.captured_on));
  console.log("D1 existing days:", [...existing].sort().join(", "));

  // 2. 拉取 archive。
  const archiveResp = await fetch(`${ARCHIVE_URL}?v=${Math.floor(Date.now() / 60000)}`, {
    headers: { Accept: "application/json", "User-Agent": "OpenClaw-Pulse-Backfill" },
  });
  if (!archiveResp.ok) throw new Error(`Archive fetch ${archiveResp.status}`);
  const archive = await archiveResp.json();
  if (!Array.isArray(archive.snapshots)) throw new Error("Archive snapshots missing");

  // 3. 选出要补的天:archive 里有、D1 里没有、且不是历史种子。
  const toInsert = archive.snapshots.filter(
    (s) => !existing.has(s.capturedOn) && s.source !== "manual-post",
  );
  console.log(`To backfill (${toInsert.length}):`, toInsert.map((s) => s.capturedOn).join(", "));

  // 4. 逐天插入(archive 快照可能缺 repo-scale 字段,统一回退 null)。
  for (const s of toInsert) {
    await d1(`INSERT INTO metric_points (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      s.capturedAt,
      s.capturedOn,
      s.issueOpen,
      s.issueClosed,
      s.prOpen,
      s.prClosed,
      s.prMerged ?? null,
      s.workflowRuns ?? null,
      s.stars ?? null,
      s.forks ?? null,
      s.subscribers ?? null,
      s.commits ?? null,
      s.contributors ?? null,
      s.source,
    ]);
    console.log(`  inserted ${s.capturedOn}: issueOpen=${s.issueOpen} prOpen=${s.prOpen}`);
  }
  console.log("done");
}

await main();
