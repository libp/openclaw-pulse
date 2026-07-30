"use client";

import { useEffect, useMemo, useState } from "react";

type Snapshot = {
  capturedOn: string;
  capturedAt: string;
  issueOpen: number;
  issueClosed: number;
  prOpen: number;
  prClosed: number;
  prMerged?: number | null;
  workflowRuns: number | null;
  stars?: number | null;
  forks?: number | null;
  subscribers?: number | null;
  commits?: number | null;
  contributors?: number | null;
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

type Activity = {
  kind: "issue" | "pr";
  number: number;
  title: string;
  url: string;
  state: string;
  author: string;
  updatedAt: string;
};

type PulseResponse = {
  repository: string;
  snapshots: Snapshot[];
  metrics?: MetricPoint[];
  activity: { issues: Activity[]; prs: Activity[] };
};

const fallback: Snapshot[] = [
  { capturedOn: "2026-03-10", capturedAt: "2026-03-10T00:00:00Z", issueOpen: 6480, issueClosed: 10686, prOpen: 5493, prClosed: 17907, workflowRuns: 521903, source: "manual-post", approximateDate: false },
  { capturedOn: "2026-06-14", capturedAt: "2026-06-14T00:00:00Z", issueOpen: 3934, issueClosed: 35875, prOpen: 3611, prClosed: 47253, workflowRuns: null, source: "manual-post", approximateDate: false },
  { capturedOn: "2026-07-12", capturedAt: "2026-07-12T00:00:00Z", issueOpen: 3578, issueClosed: 39154, prOpen: 2777, prClosed: 57051, workflowRuns: null, source: "manual-post", approximateDate: false },
];

const nf = new Intl.NumberFormat("zh-CN");
const pct = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function dateLabel(item: Snapshot) {
  const [year, month, day] = item.capturedOn.split("-");
  return `${year}.${month}.${day}`;
}

function shortTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type Interval = {
  days: number;
  closed: number;
  incoming: number;
  net: number;
  closePerDay: number;
  incomingPerDay: number;
  netPerDay: number;
  burnRatio: number;
};

function intervalMetrics(previous: Snapshot, current: Snapshot): Interval {
  const days = Math.max(
    1,
    Math.round(
      (new Date(current.capturedOn).getTime() - new Date(previous.capturedOn).getTime()) /
        86400000,
    ),
  );
  const closed =
    current.issueClosed + current.prClosed - previous.issueClosed - previous.prClosed;
  const priorTotal =
    previous.issueOpen + previous.issueClosed + previous.prOpen + previous.prClosed;
  const currentTotal =
    current.issueOpen + current.issueClosed + current.prOpen + current.prClosed;
  const incoming = currentTotal - priorTotal;
  const net =
    previous.issueOpen + previous.prOpen - current.issueOpen - current.prOpen;
  return {
    days,
    closed,
    incoming,
    net,
    closePerDay: closed / days,
    incomingPerDay: incoming / days,
    netPerDay: net / days,
    burnRatio: incoming > 0 ? closed / incoming : 0,
  };
}

// 区间序列:每个点 = 与前一个快照的 interval 值(首点为 null),用于趋势图叠加。
function intervalSeries(data: Snapshot[], key: "closed" | "burnRatio" | "closePerDay") {
  return data.map((cur, i) => (i === 0 ? null : intervalMetrics(data[i - 1], cur)[key]));
}

function TrendChart({ data }: { data: Snapshot[] }) {
  const [visible, setVisible] = useState({
    issue: true,
    pr: true,
    closed: false,
    burn: false,
    velocity: false,
  });
  const width = 1040;
  const height = 360;
  const pad = { left: 72, right: 72, top: 44, bottom: 58 };
  const maxValue =
    Math.max(1, ...data.flatMap((item) => [item.issueOpen, item.prOpen])) * 1.12;
  const x = (index: number) =>
    pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, data.length - 1);
  const yLeft = (value: number) =>
    pad.top + (1 - value / maxValue) * (height - pad.top - pad.bottom);
  const openLine = (key: "issueOpen" | "prOpen") =>
    data.map((item, index) => `${x(index)},${yLeft(item[key])}`).join(" ");

  // 叠加序列各自独立归一化到图高(closed/burn/velocity 量纲不同,无法共用轴)。
  const closedS = intervalSeries(data, "closed");
  const burnS = intervalSeries(data, "burnRatio");
  const velS = intervalSeries(data, "closePerDay");
  const normalize = (series: (number | null)[]) => {
    const vals = series.filter((v): v is number => v !== null);
    const max = Math.max(1, ...vals);
    return (v: number | null): number | null =>
      v === null ? null : pad.top + (1 - v / max) * (height - pad.top - pad.bottom);
  };
  const yClosed = normalize(closedS);
  const yBurn = normalize(burnS);
  const yVel = normalize(velS);
  const overlay = (series: (number | null)[], yf: (v: number | null) => number | null) =>
    series
      .map((v, i) => {
        const yy = yf(v);
        return v === null || yy === null ? null : `${x(i)},${yy}`;
      })
      .filter((p): p is string => p !== null)
      .join(" ");
  const toggle = (k: keyof typeof visible) =>
    setVisible((v) => ({ ...v, [k]: !v[k] }));

  return (
    <section className="trend-panel" aria-labelledby="trend-heading">
      <div className="section-heading chart-heading">
        <div>
          <p className="eyebrow">BACKLOG SIGNAL / OPEN</p>
          <h2 id="trend-heading">积压正在下降，但尚未接近归零</h2>
        </div>
        <div className="legend" aria-label="图表序列切换">
          <button className={visible.issue ? "active issue" : "issue"} onClick={() => toggle("issue")}><i />Issue</button>
          <button className={visible.pr ? "active pr" : "pr"} onClick={() => toggle("pr")}><i />Pull Request</button>
          <button className={visible.closed ? "active closed" : "closed"} onClick={() => toggle("closed")}><i />关闭增量</button>
          <button className={visible.burn ? "active burn" : "burn"} onClick={() => toggle("burn")}><i />消化比</button>
          <button className={visible.velocity ? "active velocity" : "velocity"} onClick={() => toggle("velocity")}><i />日均关闭</button>
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Issue 和 Pull Request 未关闭数量变化折线图">
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={yLeft(maxValue * ratio)} y2={yLeft(maxValue * ratio)} />
              <text className="axis-label" x={pad.left - 16} y={yLeft(maxValue * ratio) + 4} textAnchor="end">{Math.round((maxValue * ratio) / 1000)}k</text>
            </g>
          ))}
          {visible.closed && <polyline className="trend-line closed-line" points={overlay(closedS, yClosed)} />}
          {visible.burn && <polyline className="trend-line burn-line" points={overlay(burnS, yBurn)} />}
          {visible.velocity && <polyline className="trend-line velocity-line" points={overlay(velS, yVel)} />}
          {visible.issue && <polyline className="trend-line issue-line" points={openLine("issueOpen")} />}
          {visible.pr && <polyline className="trend-line pr-line" points={openLine("prOpen")} />}
          {data.map((item, index) => (
            <g key={item.capturedOn}>
              <text className="date-label" x={x(index)} y={height - 20} textAnchor="middle">{dateLabel(item)}</text>
              {visible.issue && <g className="point issue-point"><circle cx={x(index)} cy={yLeft(item.issueOpen)} r="7" /><text x={x(index)} y={yLeft(item.issueOpen) - 17} textAnchor="middle">{nf.format(item.issueOpen)}</text><title>{`${dateLabel(item)} Issue Open ${nf.format(item.issueOpen)}`}</title></g>}
              {visible.pr && <g className="point pr-point"><circle cx={x(index)} cy={yLeft(item.prOpen)} r="7" /><text x={x(index)} y={yLeft(item.prOpen) + 29} textAnchor="middle">{nf.format(item.prOpen)}</text><title>{`${dateLabel(item)} PR Open ${nf.format(item.prOpen)}`}</title></g>}
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

function RepoScaleChart({ data }: { data: MetricPoint[] }) {
  const points = data.filter((d) => d.stars !== null && d.stars !== undefined);
  const series: { key: keyof MetricPoint; label: string; color: "gold" | "teal" | "purple" | "pink" }[] = [
    { key: "stars", label: "STARS", color: "gold" },
    { key: "forks", label: "FORKS", color: "teal" },
    { key: "commits", label: "COMMITS", color: "purple" },
    { key: "contributors", label: "CONTRIBUTORS", color: "pink" },
  ];
  const latest = points[points.length - 1];
  const spark = (key: keyof MetricPoint) => {
    const vals = points
      .map((p) => p[key])
      .filter((v): v is number => v !== null && v !== undefined);
    if (vals.length < 2) return null;
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const w = 120;
    const h = 28;
    const range = Math.max(1, max - min);
    return vals
      .map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * h}`)
      .join(" ");
  };
  return (
    <section className="trend-panel" id="scale" aria-labelledby="scale-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">REPOSITORY SCALE</p>
          <h2 id="scale-heading">仓库规模</h2>
        </div>
        <p>stars / forks / commits / contributors 的当前规模与近期趋势。历史种子点无此项，自持续采集起累积。</p>
      </div>
      <div className="scale-grid">
        {series.map((s) => {
          const sp = spark(s.key);
          const val = latest?.[s.key];
          return (
            <article key={s.key} className={`scale-card ${s.color}`}>
              <span>{s.label}</span>
              <strong>{val !== null && val !== undefined ? nf.format(val) : "—"}</strong>
              {sp && (
                <svg className="spark" viewBox="0 0 120 28" preserveAspectRatio="none">
                  <polyline className={`spark-line ${s.color}-line`} points={sp} />
                </svg>
              )}
              <i>{points.length ? `${points.length} 个采集点` : "等待首次采集"}</i>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ActivityColumn({ title, items, kind }: { title: string; items: Activity[]; kind: "issue" | "pr" }) {
  return (
    <div className="activity-column">
      <div className="activity-title"><span className={`status-dot ${kind}`} />{title}<span>{items.length ? "实时" : "等待 GitHub"}</span></div>
      <div className="activity-list">
        {items.length ? items.slice(0, 5).map((item) => (
          <a href={item.url} target="_blank" rel="noreferrer" className="activity-item" key={`${kind}-${item.number}`}>
            <div><b>#{item.number}</b><span className={`state ${item.state}`}>{item.state}</span></div>
            <h3>{item.title}</h3>
            <p>@{item.author} · {shortTime(item.updatedAt)}</p>
          </a>
        )) : <p className="activity-empty">正在等待下一次 GitHub 数据刷新。</p>}
      </div>
    </div>
  );
}

export default function PulseDashboard() {
  const [pulse, setPulse] = useState<PulseResponse>({ repository: "openclaw/openclaw", snapshots: fallback, metrics: [], activity: { issues: [], prs: [] } });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pulse")
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data: PulseResponse) => setPulse(data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const snapshots = pulse.snapshots.length ? pulse.snapshots : fallback;
  const metrics = pulse.metrics ?? [];
  const latest = snapshots[snapshots.length - 1];
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : latest;
  const currentInterval = useMemo(() => intervalMetrics(previous, latest), [previous, latest]);
  const openTotal = latest.issueOpen + latest.prOpen;
  const closedTotal = latest.issueClosed + latest.prClosed;
  const openShare = (openTotal / (openTotal + closedTotal)) * 100;
  const priorOpen = previous.issueOpen + previous.prOpen;
  const reduction = priorOpen ? ((priorOpen - openTotal) / priorOpen) * 100 : 0;

  return (
    <main>
      <header className="site-header">
        <a href="#top" className="brand"><span className="pulse-mark"><i /></span><b>OpenClaw</b> Pulse</a>
        <nav aria-label="主导航"><a href="#trend">趋势</a><a href="#scale">规模</a><a href="#velocity">速度</a><a href="#activity">动态</a><a href="#method">方法</a></nav>
        <a className="repo-link" href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer"><span className="live-dot" />{pulse.repository} ↗</a>
      </header>

      <div className="page-shell" id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">AN OPEN-SOURCE AI OPERATIONS OBSERVATORY</p>
            <h1>用积压变化，<br />观察 AI 的进化速度。</h1>
            <p className="intro">持续追踪 OpenClaw 的 Issue、Pull Request 与工作流规模。真正重要的不是累计关闭多少，而是系统能否在新增需求不断涌入时，仍然稳定压降积压。</p>
            <a className="primary-action" href="#trend">查看演化时间线 <span>↓</span></a>
          </div>
          <div className="snapshot" aria-label="最新数据快照">
            <div className="snapshot-head"><div><span className={loading ? "live-dot loading" : "live-dot"} />LATEST SNAPSHOT</div><time>{dateLabel(latest)}</time></div>
            <div className="snapshot-row issue"><div><span>ISSUE</span><strong>{nf.format(latest.issueOpen)}</strong><small>OPEN</small></div><div><span>CLOSED</span><b>{nf.format(latest.issueClosed)}</b></div></div>
            <div className="snapshot-row pr"><div><span>PULL REQUEST</span><strong>{nf.format(latest.prOpen)}</strong><small>OPEN</small></div><div><span>CLOSED</span><b>{nf.format(latest.prClosed)}</b></div></div>
            <div className="snapshot-foot"><span>OPEN SHARE</span><b>{pct.format(openShare)}%</b><span>LAST SYNC</span><b>{shortTime(latest.capturedAt)}</b></div>
          </div>
        </section>

        <section className="signal-strip" aria-label="关键变化指标">
          <div><span>当前总积压</span><strong>{nf.format(openTotal)}</strong><small>Issue + PR</small></div>
          <div><span>较上次记录</span><strong className="good">−{pct.format(reduction)}%</strong><small>净减少 {nf.format(Math.max(0, priorOpen - openTotal))}</small></div>
          <div><span>关闭吞吐</span><strong>{nf.format(currentInterval.closed)}</strong><small>{pct.format(currentInterval.closePerDay)} / 天</small></div>
          <div><span>消化比</span><strong className={currentInterval.burnRatio >= 1 ? "good" : "warn"}>{currentInterval.burnRatio.toFixed(2)}×</strong><small>{currentInterval.burnRatio >= 1 ? "积压正在收缩" : "积压仍在增长"}</small></div>
        </section>

        <div id="trend"><TrendChart data={snapshots} /></div>

        <RepoScaleChart data={metrics} />

        <section className="velocity" id="velocity">
          <div className="section-heading"><div><p className="eyebrow">THE VELOCITY THAT MATTERS</p><h2>关闭很多，不等于积压减少很多</h2></div><p>最近两个快照之间，系统一边接收新任务，一边处理旧任务。净压降才是衡量自治能力的关键。</p></div>
          <div className="velocity-grid">
            <article className="terminal-card"><span>01 / CLOSED THROUGHPUT</span><strong>+{nf.format(currentInterval.closed)}</strong><p>期间关闭的 Issue 与 PR 总量</p><i>{pct.format(currentInterval.closePerDay)} / DAY</i></article>
            <article className="terminal-card"><span>02 / NEW INTAKE</span><strong>+{nf.format(currentInterval.incoming)}</strong><p>由总量变化反推的新增任务</p><i>{pct.format(currentInterval.incomingPerDay)} / DAY</i></article>
            <article className="terminal-card accent"><span>03 / NET BURN-DOWN</span><strong>−{nf.format(currentInterval.net)}</strong><p>真正从 Open 队列中消失的积压</p><i>{pct.format(currentInterval.netPerDay)} / DAY</i></article>
          </div>
          <p className="formula">消化比 = 关闭吞吐 ÷ 新增流入。高于 1.00，说明处理速度超过新增速度；持续显著高于 1，才可能接近全自主运行。</p>
        </section>

        <section className="activity" id="activity">
          <div className="section-heading"><div><p className="eyebrow">LIVE REPOSITORY ACTIVITY</p><h2>项目动态</h2></div><p>按更新时间读取 GitHub 最新动态，点击可进入原始 Issue 或 Pull Request。</p></div>
          <div className="activity-grid"><ActivityColumn title="ISSUES" items={pulse.activity.issues} kind="issue" /><ActivityColumn title="PULL REQUESTS" items={pulse.activity.prs} kind="pr" /></div>
        </section>

        <section className="timeline" aria-labelledby="timeline-title">
          <div className="section-heading"><div><p className="eyebrow">RECORDED SNAPSHOTS</p><h2 id="timeline-title">历史快照</h2></div></div>
          <div className="table-wrap"><table><thead><tr><th>日期</th><th>Issue Open</th><th>Issue Closed</th><th>PR Open</th><th>PR Closed</th><th>总积压</th></tr></thead><tbody>{[...snapshots].reverse().map((item) => <tr key={item.capturedOn}><td>{dateLabel(item)}</td><td>{nf.format(item.issueOpen)}</td><td>{nf.format(item.issueClosed)}</td><td>{nf.format(item.prOpen)}</td><td>{nf.format(item.prClosed)}</td><td><b>{nf.format(item.issueOpen + item.prOpen)}</b></td></tr>)}</tbody></table></div>
        </section>

        <section className="method" id="method">
          <p className="eyebrow">METHODOLOGY / 方法</p>
          <h2>这是 AI 协作效率的代理指标，不是智能水平的直接证明。</h2>
          <div><p>Cloudflare D1 每小时写入一条细粒度采集记录，GitHub Actions 同步维护一份可审计的公开 archive；趋势图按日聚合展示，仓库规模自持续采集起累积。Closed 的增长反映处理吞吐；Open 的下降反映净积压压降；两者必须结合新增流入一起判断。</p><p>关闭可能包含重复、无效、垃圾内容或人工批量操作，PR Closed 也同时包含 merged 与未合并关闭。仓库规模（stars/forks/commits/contributors）为辅助上下文，反映项目热度而非模型智力。因此，本网站衡量的是大型 AI 原生项目的协作与治理能力，而非单一模型的智力。</p></div>
        </section>
      </div>

      <footer><div><b>OpenClaw Pulse</b><span>Observe the backlog. Measure the autonomy.</span></div><a href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer">DATA: GITHUB PUBLIC API ↗</a></footer>
    </main>
  );
}
