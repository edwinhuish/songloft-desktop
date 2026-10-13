/** 纯格式化工具（无副作用，可单测） */

/** 秒 → `m:ss` / `h:mm:ss`；未知时长返回 `--:--` */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return '--:--'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 秒 → `1 小时 23 分` 这类人话（统计面板用） */
export function formatDurationLong(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 分钟'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`
  if (m > 0) return `${m} 分钟`
  return `${total} 秒`
}

/** 字节 → 人类可读。用 1024 进制（与后端返回的字节数一致，别混用 1000）。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  const digits = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[index]}`
}

/** 大数字 → `1.2 万` / `3.4 亿`（中文习惯） */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '0'
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)} 亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return String(value)
}

/** 码率数字 → `320 kbps` */
export function formatBitrate(bitRate: number): string {
  if (!Number.isFinite(bitRate) || bitRate <= 0) return ''
  return bitRate >= 1000 ? `${(bitRate / 1000).toFixed(1)} Mbps` : `${bitRate} kbps`
}

/** 采样率 → `44.1 kHz` */
export function formatSampleRate(sampleRate: number): string {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return ''
  return `${(sampleRate / 1000).toFixed(1)} kHz`
}

const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

/** ISO 字符串 → `2026/10/12`；解析失败返回空串 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return DATE_FMT.format(date)
}

/** 相对时间：刚刚 / 3 分钟前 / 昨天 / 2026/10/12 */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Date.now() - date.getTime()
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 2 * day) return '昨天'
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  return formatDate(iso)
}

/** 去掉文件名里的扩展名与常见的 `01. ` 前缀，让标题更像歌名 */
export function cleanTitle(raw: string): string {
  return raw.replace(/\.[a-z0-9]{2,5}$/i, '').trim()
}

/** 歌手列表展示：多个歌手用 ` / ` 连接，空值回退 `未知歌手` */
export function displayArtist(artist: string | null | undefined): string {
  const value = (artist ?? '').trim()
  return value || '未知歌手'
}

/** 专辑展示 */
export function displayAlbum(album: string | null | undefined): string {
  const value = (album ?? '').trim()
  return value || '未知专辑'
}

/**
 * 版本号的展示形式。
 *
 * 后端 `/api/v1/version` 在正式发版下**自带 `v`**（发版时把 git tag `v2.13.1` 原值注入），
 * 本地/开发构建则是 `2.13.1` / `dev`。所以补前缀前必须先看有没有 —— 无条件拼一个 `v`
 * 就是 `vv2.13.1`。
 */
export function formatVersion(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) return '未知'
  if (value === 'dev') return '开发版'
  return value.startsWith('v') ? value : `v${value}`
}

/** 连接耗时档位：给标签用的文案 + 配色档（对应 .badge 的 data-tone） */
export interface LatencyLevel {
  label: string
  tone: 'good' | 'fair' | 'slow' | 'poor' | 'bad'
}

/**
 * 连接耗时分级，绿 → 红共五档。
 *
 * 阈值按「自建后端」的常见分布定：同机 / 局域网个位数到几十毫秒，同城几十毫秒，
 * 跨地区一百到三百，跨境或链路差则数百以上。分五档而不是三档，是因为真正要人拿主意的
 * 恰恰是中间两档 —— 「连得上，但要不要换个地址、走代理」。
 */
export function latencyLevel(ms: number): LatencyLevel {
  if (ms <= 30) return { label: '极快', tone: 'good' }
  if (ms <= 80) return { label: '快', tone: 'fair' }
  if (ms <= 200) return { label: '一般', tone: 'slow' }
  if (ms <= 500) return { label: '偏慢', tone: 'poor' }
  return { label: '很慢', tone: 'bad' }
}
