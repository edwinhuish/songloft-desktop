/**
 * 主进程侧的对外网络动作。
 *
 * 走 Electron 的 `net.fetch`（Chromium 网络栈）而不是 Node 的 global fetch：
 * 这样「忽略 TLS 证书校验」这个开关可以通过 session.setCertificateVerifyProc 统一生效，
 * 同时覆盖 API、封面、音频三条链路 —— 自签证书的内网服务器是这类自托管项目的常态。
 */

import { net } from 'electron'

import type { BackendVersion } from '@shared/types'
import type { ServerProbeResult } from '@shared/ipc'

const PROBE_TIMEOUT_MS = 6000

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

type VersionProbe = { ok: true; version: string | null } | { ok: false; error: string }

/**
 * 只探版本接口。
 *
 * 版本接口通了（含 401/403）就认为「地址上确实有个 Songloft」；
 * 404 说明可达但不是这个服务（或 BASE_PATH 配了子路径），这是新装用户最常踩的坑，
 * 单独给一句能对症的提示。
 */
async function probeVersion(base: string): Promise<VersionProbe> {
  try {
    const res = await net.fetch(`${base}/api/v1/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    if (res.ok) {
      const body = (await res.json()) as BackendVersion
      const candidate = body.version ?? body.git_commit ?? null
      return { ok: true, version: typeof candidate === 'string' ? candidate : null }
    }
    if (res.status === 401 || res.status === 403) return { ok: true, version: null }
    if (res.status === 404) {
      return {
        ok: false,
        error: '地址可达，但找不到 /api/v1/version —— 可能不是 Songloft 后端，或 BASE_PATH 配了子路径'
      }
    }
    return { ok: false, error: `版本接口返回 HTTP ${res.status}` }
  } catch (error) {
    return { ok: false, error: describeFetchError(error) }
  }
}

/** 探测一个 Songloft 后端：/api/v1/version + /health */
export async function probeServer(rawUrl: string): Promise<ServerProbeResult> {
  const started = Date.now()
  const base = normalizeBase(rawUrl)
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, version: null, healthy: false, error: '地址必须以 http:// 或 https:// 开头', elapsedMs: 0 }
  }

  const probe = await probeVersion(base)
  if (!probe.ok) {
    return { ok: false, version: null, healthy: false, error: probe.error, elapsedMs: Date.now() - started }
  }

  // health 探不到不算致命：版本接口已经证明后端在跑，健康检查可能只是被反代挡了
  const healthy = await net
    .fetch(`${base}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    .then((res) => res.ok)
    .catch(() => false)

  return { ok: true, version: probe.version, healthy, error: null, elapsedMs: Date.now() - started }
}

function describeFetchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/certificate|SELF_SIGNED|ERR_CERT/i.test(message)) {
    return 'TLS 证书校验失败 —— 自签证书请在设置里打开「忽略证书校验」'
  }
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(message)) return '连接被拒绝：服务没在跑，或端口不对'
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED/i.test(message)) return '域名解析失败'
  if (/timeout|ETIMEDOUT|ERR_TIMED_OUT/i.test(message)) return '连接超时'
  return message
}

export interface CoverBytes {
  base64: string
  mime: string
}

/**
 * 取封面缩略图的原始字节（供渲染层在 canvas 上取主色）。
 *
 * 为什么要绕主进程：canvas.getImageData() 对跨域图片会因画布污染直接抛异常，
 * 而自建后端通常不发 CORS 头。主进程取字节 → base64 → 渲染层用 createImageBitmap
 * 从本地 Blob 解码，就没有同源问题，也不需要关掉 webSecurity。
 *
 * 附带 `w=96` 让后端把封面缩成小图（songloft 的封面端点支持该参数），
 * 一次传输通常只有几 KB。
 */
export async function fetchCoverBytes(url: string): Promise<CoverBytes | null> {
  if (!/^https?:\/\//i.test(url)) return null
  const withSize = /[?&]w=\d+/.test(url) ? url : `${url}${url.includes('?') ? '&' : '?'}w=96`
  try {
    const res = await net.fetch(withSize, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    if (!res.ok) return null
    const mime = res.headers.get('content-type') ?? 'image/jpeg'
    if (!mime.startsWith('image/')) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    // 兜底上限：缩略图不该超过 2MB，超了说明后端忽略了 w= 参数
    if (buffer.byteLength > 2 * 1024 * 1024) return null
    return { base64: buffer.toString('base64'), mime }
  } catch (error) {
    console.warn('[cover] 取封面字节失败', error)
    return null
  }
}
