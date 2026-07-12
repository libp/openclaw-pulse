# OpenClaw Pulse

OpenClaw Pulse 是一个公开的数据观测站，用 Issue、Pull Request 和 GitHub Actions 的变化，观察大型 AI 原生项目的协作吞吐与积压压降速度。

## 核心指标

- **关闭吞吐**：区间内累计关闭的 Issue 与 PR
- **新增流入**：由 Open + Closed 总量变化反推的新任务量
- **净压降**：Open 队列真正减少的数量
- **消化比**：关闭吞吐 ÷ 新增流入；高于 1 表示积压正在收缩

## 自动采集

`.github/workflows/collect-metrics.yml` 每小时运行一次：

1. 使用仓库自带的 `GITHUB_TOKEN` 查询 `openclaw/openclaw`；
2. 读取 Issue、Pull Request、Actions 总量和最新动态；
3. 更新 `public/data/pulse.json`；
4. 仅在数据发生变化时自动提交。

网站服务端优先读取这份公开数据，因此即使网站无人访问，历史数据仍会持续采集。工作流也支持在 GitHub Actions 页面手动运行。

## 本地开发

需要 Node.js 22.13 或更高版本。

```bash
npm ci
npm run dev
```

手动采集一次数据：

```bash
GITHUB_TOKEN=your_token node scripts/collect-github-data.mjs
```

## 数据说明

GitHub 的 Closed 统计包含关闭、合并、重复项清理等多种情形。本项目将这些数据作为 AI 协作和项目治理效率的代理指标，不把它们直接等同于模型智能水平。
