"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";

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

export type PulseResponse = {
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

type Pt = [number, number];

// Catmull-Rom → 三次贝塞尔:把折线变成平滑曲线。
function smoothPath(pts: Pt[]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0][0]},${pts[0][1]}`;
  if (pts.length === 2) return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`;
  let d = `M ${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

// 平滑曲线下方的渐变填充区域(闭合到基线)。
function areaPath(pts: Pt[], baseY: number): string {
  if (pts.length < 2) return "";
  return `${smoothPath(pts)} L ${pts[pts.length - 1][0]},${baseY} L ${pts[0][0]},${baseY} Z`;
}

function shortDate(item: Snapshot) {
  const [, m, d] = item.capturedOn.split("-");
  return `${Number(m)}.${Number(d)}`;
}

function TrendChart({ data }: { data: Snapshot[] }) {
  const [visible, setVisible] = useState({
    issue: true,
    pr: true,
    closed: false,
    burn: false,
    velocity: false,
  });
  const [hover, setHover] = useState<number | null>(null);
  const width = 1040;
  const height = 420;
  const pad = { left: 60, right: 24, top: 36, bottom: 52 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const baseY = pad.top + plotH;
  const maxValue =
    Math.max(1, ...data.flatMap((item) => [item.issueOpen, item.prOpen])) * 1.14;
  const x = (index: number) =>
    pad.left + (index * plotW) / Math.max(1, data.length - 1);
  const yLeft = (value: number) => pad.top + (1 - value / maxValue) * plotH;
  const issuePts: Pt[] = data.map((item, index) => [x(index), yLeft(item.issueOpen)]);
  const prPts: Pt[] = data.map((item, index) => [x(index), yLeft(item.prOpen)]);

  // x 轴标签抽稀:点很多时按步长显示,首尾必显,避免日期挤在一起。
  const labelStep = data.length <= 6 ? 1 : Math.ceil(data.length / 6);
  const showLabel = (i: number) =>
    i === 0 || i === data.length - 1 || i % labelStep === 0;

  // 叠加序列各自独立归一化到图高(closed/burn/velocity 量纲不同,无法共用轴)。
  const closedS = intervalSeries(data, "closed");
  const burnS = intervalSeries(data, "burnRatio");
  const velS = intervalSeries(data, "closePerDay");
  const normalize = (series: (number | null)[]) => {
    const vals = series.filter((v): v is number => v !== null);
    const max = Math.max(1, ...vals);
    return (v: number | null): number | null =>
      v === null ? null : pad.top + (1 - v / max) * plotH;
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

  // 鼠标横坐标 → 最近的数据点索引。
  const onMove = (event: MouseEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * Math.max(1, data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, idx)));
  };

  const h = hover;
  const tipW = 168;
  const tipX =
    h !== null && x(h) > width / 2
      ? Math.max(pad.left, x(h) - tipW - 16)
      : h !== null
        ? Math.min(width - pad.right - tipW, x(h) + 16)
        : 0;
  const isEndpoint = (i: number) => i === 0 || i === data.length - 1;

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
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="Issue 和 Pull Request 未关闭数量变化折线图"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="issueArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0e97b0" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0e97b0" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="prArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#c2740a" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#c2740a" stopOpacity="0" />
            </linearGradient>
          </defs>

          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
            <g key={ratio}>
              <line className={ratio === 0 ? "grid-line baseline" : "grid-line"} x1={pad.left} x2={width - pad.right} y1={yLeft(maxValue * ratio)} y2={yLeft(maxValue * ratio)} />
              <text className="axis-label" x={pad.left - 12} y={yLeft(maxValue * ratio) + 4} textAnchor="end">{Math.round((maxValue * ratio) / 1000)}k</text>
            </g>
          ))}

          {visible.closed && <polyline className="trend-line closed-line" points={overlay(closedS, yClosed)} />}
          {visible.burn && <polyline className="trend-line burn-line" points={overlay(burnS, yBurn)} />}
          {visible.velocity && <polyline className="trend-line velocity-line" points={overlay(velS, yVel)} />}

          {visible.issue && <path className="area-fill" d={areaPath(issuePts, baseY)} fill="url(#issueArea)" />}
          {visible.pr && <path className="area-fill" d={areaPath(prPts, baseY)} fill="url(#prArea)" />}
          {visible.issue && <path className="trend-line issue-line" d={smoothPath(issuePts)} />}
          {visible.pr && <path className="trend-line pr-line" d={smoothPath(prPts)} />}

          {data.map((item, index) =>
            showLabel(index) ? (
              <text key={`d-${item.capturedOn}`} className="date-label" x={x(index)} y={height - 18} textAnchor="middle">{shortDate(item)}</text>
            ) : null,
          )}

          {/* 首尾端点:数据点 + 数值标注 */}
          {data.map((item, index) =>
            isEndpoint(index) ? (
              <g key={`p-${item.capturedOn}`}>
                {visible.issue && (
                  <g className={`point issue-point${index === data.length - 1 ? " live" : ""}`}>
                    <circle cx={x(index)} cy={yLeft(item.issueOpen)} r="6.5" />
                    <text x={x(index)} y={yLeft(item.issueOpen) - 14} textAnchor={index === 0 ? "start" : "end"} dx={index === 0 ? 8 : -8}>{nf.format(item.issueOpen)}</text>
                  </g>
                )}
                {visible.pr && (
                  <g className={`point pr-point${index === data.length - 1 ? " live" : ""}`}>
                    <circle cx={x(index)} cy={yLeft(item.prOpen)} r="6.5" />
                    <text x={x(index)} y={yLeft(item.prOpen) + 22} textAnchor={index === 0 ? "start" : "end"} dx={index === 0 ? 8 : -8}>{nf.format(item.prOpen)}</text>
                  </g>
                )}
              </g>
            ) : null,
          )}

          {/* 悬浮:竖向引导线 + 高亮点 + 数据弹窗 */}
          {h !== null && (
            <g className="hover-guide">
              <line className="guide-line" x1={x(h)} x2={x(h)} y1={pad.top} y2={baseY} />
              {visible.issue && <circle className="guide-dot issue" cx={x(h)} cy={yLeft(data[h].issueOpen)} r="6.5" />}
              {visible.pr && <circle className="guide-dot pr" cx={x(h)} cy={yLeft(data[h].prOpen)} r="6.5" />}
              <g className="tooltip" transform={`translate(${tipX}, ${pad.top + 4})`}>
                <rect className="tip-bg" width={tipW} height={72} rx="6" />
                <text className="tip-date" x="12" y="22">{dateLabel(data[h])}</text>
                <circle className="tip-issue" cx="20" cy="40" r="3.5" />
                <text className="tip-row issue" x="32" y="44">{`Issue ${nf.format(data[h].issueOpen)}`}</text>
                <circle className="tip-pr" cx="20" cy="59" r="3.5" />
                <text className="tip-row pr" x="32" y="63">{`PR ${nf.format(data[h].prOpen)}`}</text>
              </g>
            </g>
          )}

          {/* 鼠标捕获层(置顶,透明) */}
          <rect className="capture" x={pad.left} y={pad.top} width={plotW} height={plotH} onMouseMove={onMove} />
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

// ── signal-strip enrichment: mini sparkline + 末两点环比 chip ──
const SPARK_TONE = ["cyan", "gold", "teal", "green"] as const;
type SparkTone = (typeof SPARK_TONE)[number];

function Sparkline({ values, tone }: { values: (number | null)[]; tone: SparkTone }) {
  const pts = values
    .map((v, i): [number, number] | null => (v === null ? null : [i, v]))
    .filter((p): p is [number, number] => p !== null);
  if (pts.length < 2) return null;
  const w = 100, h = 34, pad = 3;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rx = Math.max(1, maxX - minX), ry = Math.max(1, maxY - minY);
  const px = (i: number) => pad + ((i - minX) / rx) * (w - pad * 2);
  const py = (v: number) => h - pad - ((v - minY) / ry) * (h - pad * 2);
  const line = pts.map(([i, v]) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const area = `${line} ${px(maxX).toFixed(1)},${(h - pad).toFixed(1)} ${px(minX).toFixed(1)},${(h - pad).toFixed(1)}`;
  const last = pts[pts.length - 1];
  return (
    <svg className={`kpi-spark tone-${tone}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polygon className="spark-area" points={area} />
      <polyline className="spark-line" points={line} />
      <circle className="spark-tip" cx={px(last[0])} cy={py(last[1])} r="2.2" />
    </svg>
  );
}

type Trend = { dir: "up" | "down" | "flat"; pct: number } | null;
// 取序列末两个非空点,算环比方向 + 百分比。
function trendDelta(values: (number | null)[]): Trend {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return null;
  const last = v[v.length - 1], prev = v[v.length - 2];
  if (!prev) return null;
  const p = ((last - prev) / Math.abs(prev)) * 100;
  return { dir: Math.abs(p) < 0.5 ? "flat" : p > 0 ? "up" : "down", pct: p };
}

function Chip({ delta, goodWhen }: { delta: Trend; goodWhen: "up" | "down" }) {
  if (!delta) return <em className="chip mute">初始基线</em>;
  if (delta.dir === "flat") return <em className="chip mute">持平</em>;
  const favorable = delta.dir === goodWhen;
  const arrow = delta.dir === "up" ? "▲" : "▼";
  return <em className={`chip ${favorable ? "pos" : "neg"}`}>{arrow} {Math.abs(delta.pct).toFixed(1)}%</em>;
}

export default function PulseDashboard({ initial }: { initial: PulseResponse | null }) {
  const [pulse, setPulse] = useState<PulseResponse>(initial ?? { repository: "openclaw/openclaw", snapshots: fallback, metrics: [], activity: { issues: [], prs: [] } });
  const [loading, setLoading] = useState(!initial);

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

  // 信号条 sparkline 序列:每个指标的历史走势 + 末两点环比。
  const openSeries = snapshots.map((s) => s.issueOpen + s.prOpen);
  const reductionSeries: (number | null)[] = snapshots.map((s, i) => {
    if (i === 0) return null;
    const prior = snapshots[i - 1].issueOpen + snapshots[i - 1].prOpen;
    const now = s.issueOpen + s.prOpen;
    return prior ? ((prior - now) / prior) * 100 : null;
  });
  const closedSeries = intervalSeries(snapshots, "closed");
  const burnSeries = intervalSeries(snapshots, "burnRatio");
  const netReduce = Math.max(0, priorOpen - openTotal);

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
          <div>
            <span>当前总积压</span>
            <div className="kpi-main">
              <strong>{nf.format(openTotal)}</strong>
              <em className={`chip ${netReduce > 0 ? "pos" : "neg"}`}>{netReduce > 0 ? "▼" : "▲"} {nf.format(netReduce)} 件</em>
            </div>
            <Sparkline values={openSeries} tone="cyan" />
            <small>Issue + PR 未关闭合计</small>
          </div>
          <div>
            <span>较上次压降</span>
            <div className="kpi-main">
              <strong className="good">−{pct.format(reduction)}%</strong>
              <Chip delta={trendDelta(reductionSeries)} goodWhen="up" />
            </div>
            <Sparkline values={reductionSeries} tone="gold" />
            <small>相对上一快照的开放积压</small>
          </div>
          <div>
            <span>关闭吞吐</span>
            <div className="kpi-main">
              <strong>{nf.format(currentInterval.closed)}</strong>
              <Chip delta={trendDelta(closedSeries)} goodWhen="up" />
            </div>
            <Sparkline values={closedSeries} tone="teal" />
            <small>{pct.format(currentInterval.closePerDay)} / 天</small>
          </div>
          <div>
            <span>消化比</span>
            <div className="kpi-main">
              <strong className={currentInterval.burnRatio >= 1 ? "good" : "warn"}>{currentInterval.burnRatio.toFixed(2)}×</strong>
              <Chip delta={trendDelta(burnSeries)} goodWhen="up" />
            </div>
            <Sparkline values={burnSeries} tone="green" />
            <small>{currentInterval.burnRatio >= 1 ? "积压正在收缩" : "积压仍在增长"}</small>
          </div>
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
          <div className="method-intro">
            <p className="eyebrow">METHODOLOGY / 方法</p>
            <h2>这是 AI 协作效率的代理指标，不是智能水平的直接证明。</h2>
          </div>
          <div className="method-body"><p>Cloudflare D1 每小时写入一条细粒度采集记录，GitHub Actions 同步维护一份可审计的公开 archive；趋势图按日聚合展示，仓库规模自持续采集起累积。Closed 的增长反映处理吞吐；Open 的下降反映净积压压降；两者必须结合新增流入一起判断。</p><p>关闭可能包含重复、无效、垃圾内容或人工批量操作，PR Closed 也同时包含 merged 与未合并关闭。仓库规模（stars/forks/commits/contributors）为辅助上下文，反映项目热度而非模型智力。因此，本网站衡量的是大型 AI 原生项目的协作与治理能力，而非单一模型的智力。</p></div>
        </section>
      </div>

      <footer><div><b>OpenClaw Pulse</b><span>Observe the backlog. Measure the autonomy.</span></div><a href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer">DATA: GITHUB PUBLIC API ↗</a></footer>
    </main>
  );
}
