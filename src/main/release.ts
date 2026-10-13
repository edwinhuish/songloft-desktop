/**
 * 客户端（桌面端自身）的更新检查。
 *
 * **只查不装**，这是刻意的：桌面端由安装包 / 包管理器分发，应用替自己换二进制一旦半路失败
 * （下载中断、目录不可写、替换到一半），用户手上就剩一个跑不起来的东西，而且没有回滚 ——
 * AppImage 那套自更新正是「先删掉旧文件，再移入新文件」。所以这里只回答「有没有新版本」，
 * 换不换、什么时候换，交给人去做。
 *
 * 放在主进程有三个具体理由：
 *   1. 渲染层不该直连第三方（它连后端都要走封装好的 ApiClient）；
 *   2. 主进程没有 CORS 限制 —— 打包态页面源是 file://，Origin 为 null；
 *   3. GitHub 接口要求带 User-Agent，而渲染层改不了这个头（forbidden header）。
 */

import { app, net } from 'electron'

import type { ClientUpdateCheck } from '@shared/ipc'
import { REPO_SLUG } from '@shared/links'

/** 查一次的上限。连不上 GitHub 时默认要等很久，界面会一直停在「正在检查」 */
const TIMEOUT_MS = 8000

/** 把失败讲成一句能看懂的话：403 / 404 的原因与「网络不通」完全不是一回事 */
function describeStatus(status: number): string {
  if (status === 403) return 'GitHub 拒绝了这次请求（共享网络下常见，是频率限制），稍后再试'
  if (status === 404) return 'GitHub 上找不到这个仓库的发布记录'
  return `GitHub 返回了 HTTP ${status}`
}

/**
 * 查 GitHub 上的最新 release。
 *
 * `proxyPrefix` 是「网络设置」里那个 GitHub 加速代理（形如 `https://ghfast.top/`），拼在地址
 * 前面；传空串就直连。取不到代理也照样直连 —— 客户端更新这件事不该被后端的可达性牵连。
 */
export async function checkClientUpdate(proxyPrefix = ''): Promise<ClientUpdateCheck> {
  const target = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`
  const url = proxyPrefix ? `${proxyPrefix}${target}` : target

  // 不写 Response 类型：主进程这份 tsconfig 不带 DOM lib，交给 net.fetch 自己的声明推
  let response: Awaited<ReturnType<typeof net.fetch>>
  try {
    response = await net.fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `songloft-desktop/${app.getVersion()}`
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    // 带上 cause：给界面看的是那句话，排查时原始错误（DNS/证书/代理）不能丢
    throw new Error(
      `检查更新失败：${timedOut ? `超过 ${TIMEOUT_MS / 1000} 秒没有响应` : '连不上 GitHub'}。可以直接到发布页看`,
      { cause: error }
    )
  }

  if (!response.ok) throw new Error(`检查更新失败：${describeStatus(response.status)}`)

  const data = (await response.json()) as {
    tag_name?: string
    html_url?: string
    published_at?: string
  }

  return {
    latestTag: data.tag_name ?? '',
    latestUrl: data.html_url ?? '',
    publishedAt: data.published_at ?? ''
  }
}
