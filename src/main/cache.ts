/**
 * 本机磁盘缓存（客户端自己那份）。
 *
 * 桌面端没有另写一套缓存：封面图与接口响应直接交给 Chromium 的会话缓存，字节落在 userData 里。
 * 归本机所有 —— 换服务器、换账号都不会跟着走，换台机器更是从零开始。
 *
 * 与服务端音乐缓存（设置页里那一张卡片）不要混：那份在服务器上、所有设备共用，走 HTTP 接口；
 * 这份的读写只有主进程能做（渲染层连不上会话缓存）。
 */

import { app, session } from 'electron'

import type { LocalCacheStats } from '@shared/ipc'

/**
 * 启动时交给 Chromium 的上限（0 = 不限）。
 *
 * 留着它不是为了配置，而是给界面一个「现在**真正**生效的是多少」的口径：
 * 用户刚改完设置、还没重启时，设置里的值与生效值不是一回事，两处都摆出来才不误导。
 */
let appliedMaxSize = 0

/**
 * 应用本机缓存上限。
 *
 * ★ 必须在 app ready 之前调用：Chromium 只在解析启动参数时读一次 `--disk-cache-size`，
 *   运行中没有任何 Electron API 能改它（`session.setCacheSize` 并不存在）。所以设置改动
 *   一律「存下来 + 下次启动生效」，界面上也要这么说。
 */
export function applyLocalCacheLimit(maxSize: number): void {
  appliedMaxSize = maxSize > 0 ? maxSize : 0
  if (appliedMaxSize > 0) app.commandLine.appendSwitch('disk-cache-size', String(appliedMaxSize))
}

/** 读本机缓存占用。session 只在 ready 之后可用，所以这条只能由 IPC 触发 */
export async function readLocalCache(): Promise<LocalCacheStats> {
  const ses = session.defaultSession
  return { size: await ses.getCacheSize(), maxSize: appliedMaxSize }
}

/**
 * 清掉本机缓存并回读占用。
 *
 * 清的是 HTTP 缓存与 JS 代码缓存，**不动** Local Storage / IndexedDB（真清那两处等于把
 * 会话里的东西一起端掉）。凭据与设置本来就在 ConfigStore 的 JSON 里，不受影响。
 */
export async function clearLocalCache(): Promise<LocalCacheStats> {
  const ses = session.defaultSession
  await ses.clearCache()
  // 代码缓存不进 HTTP 缓存，但它同样是缓存、同样会慢慢长大，一起清掉
  await ses.clearCodeCaches({})
  return readLocalCache()
}
