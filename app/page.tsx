import PulseDashboard from "./pulse-dashboard";
import type { PulseResponse } from "./pulse-dashboard";

const ARCHIVE_URL =
  "https://raw.githubusercontent.com/libp/openclaw-pulse/main/public/data/pulse.json";

// 服务端预取公开 archive(GitHub Actions 每小时维护的 pulse.json),让首屏 HTML 直接
// 带最新数据,而不是先用硬编码 fallback(3 个旧种子点)占位、再等客户端 fetch 替换。
// 用外部 raw URL 而非自请求 /api/pulse —— worker 自请求自己的公网 URL 会返回 404。
export default async function Home() {
  let initial: PulseResponse | null = null;
  try {
    const resp = await fetch(ARCHIVE_URL, { cache: "no-store" });
    if (resp.ok) initial = (await resp.json()) as PulseResponse;
  } catch {
    // 预取失败时由客户端兜底再 fetch /api/pulse。
  }
  return <PulseDashboard initial={initial} />;
}
