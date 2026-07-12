"use client";

import { useEffect, useMemo, useState } from "react";

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
  activity: { issues: Activity[]; prs: Activity[] };
};

const fallback: Snapshot[] = [
  { capturedOn: "2026-03-01", capturedAt: "2026-03-01T00:00:00Z", issueOpen: 6480, issueClosed: 10686, prOpen: 5493, prClosed: 17907, workflowRuns: 521903, source: "manual-post", approximateDate: true },
  { capturedOn: "2026-06-14", capturedAt: "2026-06-14T00:00:00Z", issueOpen: 3934, issueClosed: 35875, prOpen: 3611, prClosed: 47253, workflowRuns: null, source: "manual-post", approximateDate: false },
  { capturedOn: "2026-07-12", capturedAt: "2026-07-12T00:00:00Z", issueOpen: 3578, issueClosed: 39154, prOpen: 2777, prClosed: 57051, workflowRuns: null, source: "manual-post", approximateDate: false },
];

const nf = new Intl.NumberFormat("zh-CN");
const pct = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 });

function dateLabel(item: Snapshot) {
  if (item.approximateDate) return "2026年3月";
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

function intervalMetrics(previous: Snapshot, current: Snapshot) {
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

function TrendChart({ data }: { data: Snapshot[] }) {
  const [visible, setVisible] = useState({ issue: true, pr: true });
  const width = 1040;
  const height = 330;
  const pad = { left: 72, right: 42, top: 44, bottom: 58 };
  const maxValue = Math.max(...data.flatMap((item) => [item.issueOpen, item.prOpen])) * 1.12;
  const x = (index: number) =>
    pad.left + (index * (width - pad.left - pad.right)) / Math.max(1, data.length - 1);
  const y = (value: number) =>
    pad.top + (1 - value / maxValue) * (height - pad.top - pad.bottom);
  const line = (key: "issueOpen" | "prOpen") =>
    data.map((item, index) => `${x(index)},${y(item[key])}`).join(" ");

  return (
    <section className="trend-panel" aria-labelledby="trend-heading">
      <div className="section-heading chart-heading">
        <div>
          <p className="eyebrow">BACKLOG SIGNAL / OPEN</p>
          <h2 id="trend-heading">积压正在下降，但尚未接近归零</h2>
        </div>
        <div className="legend" aria-label="图表序列切换">
          <button className={visible.issue ? "active issue" : "issue"} onClick={() => setVisible((v) => ({ ...v, issue: !v.issue }))}><i />Issue</button>
          <button className={visible.pr ? "active pr" : "pr"} onClick={() => setVisible((v) => ({ ...v, pr: !v.pr }))}><i />Pull Request</button>
        </div>
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Issue 和 Pull Request 未关闭数量变化折线图">
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <line className="grid-line" x1={pad.left} x2={width - pad.right} y1={y(maxValue * ratio)} y2={y(maxValue * ratio)} />
              <text className="axis-label" x={pad.left - 16} y={y(maxValue * ratio) + 4} textAnchor="end">{Math.round((maxValue * ratio) / 1000)}k</text>
            </g>
          ))}
          {visible.issue && <polyline className="trend-line issue-line" points={line("issueOpen")} />}
          {visible.pr && <polyline className="trend-line pr-line" points={line("prOpen")} />}
          {data.map((item, index) => (
            <g key={item.capturedOn}>
              <text className="date-label" x={x(index)} y={height - 20} textAnchor="middle">{dateLabel(item)}</text>
              {visible.issue && <g className="point issue-point"><circle cx={x(index)} cy={y(item.issueOpen)} r="7" /><text x={x(index)} y={y(item.issueOpen) - 17} textAnchor="middle">{nf.format(item.issueOpen)}</text><title>{`${dateLabel(item)} Issue Open ${nf.format(item.issueOpen)}`}</title></g>}
              {visible.pr && <g className="point pr-point"><circle cx={x(index)} cy={y(item.prOpen)} r="7" /><text x={x(index)} y={y(item.prOpen) + 29} textAnchor="middle">{nf.format(item.prOpen)}</text><title>{`${dateLabel(item)} PR Open ${nf.format(item.prOpen)}`}</title></g>}
            </g>
          ))}
        </svg>
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
  const [pulse, setPulse] = useState<PulseResponse>({ repository: "openclaw/openclaw", snapshots: fallback, activity: { issues: [], prs: [] } });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pulse")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: PulseResponse) => setPulse(data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const snapshots = pulse.snapshots.length ? pulse.snapshots : fallback;
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
        <nav aria-label="主导航"><a href="#trend">趋势</a><a href="#velocity">速度</a><a href="#activity">动态</a><a href="#method">方法</a></nav>
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
          <div className="table-wrap"><table><thead><tr><th>日期</th><th>Issue Open</th><th>Issue Closed</th><th>PR Open</th><th>PR Closed</th><th>总积压</th></tr></thead><tbody>{[...snapshots].reverse().map((item) => <tr key={item.capturedOn}><td>{dateLabel(item)}{item.approximateDate && <small> 原帖日期未注明</small>}</td><td>{nf.format(item.issueOpen)}</td><td>{nf.format(item.issueClosed)}</td><td>{nf.format(item.prOpen)}</td><td>{nf.format(item.prClosed)}</td><td><b>{nf.format(item.issueOpen + item.prOpen)}</b></td></tr>)}</tbody></table></div>
        </section>

        <section className="method" id="method">
          <p className="eyebrow">METHODOLOGY / 方法</p>
          <h2>这是 AI 协作效率的代理指标，不是智能水平的直接证明。</h2>
          <div><p>GitHub Actions 每小时主动读取 GitHub 公共接口，并将结果提交为可审计的历史数据；当天数据持续更新，每天最终保留一个快照。Closed 的增长反映处理吞吐；Open 的下降反映净积压压降；两者必须结合新增流入一起判断。</p><p>关闭可能包含重复、无效、垃圾内容或人工批量操作，PR Closed 也同时包含 merged 与未合并关闭。因此，本网站衡量的是大型 AI 原生项目的协作与治理能力，而非单一模型的智力。</p></div>
        </section>
      </div>

      <footer><div><b>OpenClaw Pulse</b><span>Observe the backlog. Measure the autonomy.</span></div><a href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer">DATA: GITHUB PUBLIC API ↗</a></footer>
    </main>
  );
}
