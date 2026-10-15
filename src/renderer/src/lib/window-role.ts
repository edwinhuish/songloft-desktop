/**
 * 「我现在跑在哪个窗口里」——渲染层这边的读法（口径在 @shared/window-role）。
 *
 * 两个窗口（主窗口 / 迷你窗）加载的是**同一个入口文件**，只有 URL 的 hash 不同
 * （见 main/mini-window.ts）。于是渲染层有三处要按它分流：
 *   · main.tsx —— 挂 App 还是挂 MiniApp；
 *   · state/usePlayer.ts —— 这个窗口当**播放器（宿主）**还是当主窗口的**镜像**；
 *   · state/useSettings.ts —— 歌词文字色回落到哪一档（迷你窗回落墨色，见那里的说明）。
 *
 * ★ 为什么不做成两份 HTML 入口：那样要复制一套 index.html 与构建配置，而两者的差别只有
 *   一个 hash 那么点 —— 多一个入口就是多一处要记得跟着改的地方。
 *
 * ★ 角色是**模块加载时**读一次就定下来的（窗口终身不换身份），所以导出的是函数而不是
 *   一个可变量：读它的人拿到的永远是同一个答案，不必担心「两次读到不一样」。
 */

import { roleFromHash, type WindowRole } from '@shared/window-role'

const role: WindowRole = roleFromHash(window.location.hash)

export function windowRole(): WindowRole {
  return role
}

/** 迷你窗（跟随者与宿主都算）：整窗只有一条播放条 + 一块可展开的面板 */
export function isMiniWindow(): boolean {
  return role !== 'main'
}

/** 迷你窗 · **宿主**：这个窗口自己就是播放器（本地文件会话，没有主窗口） */
export function isMiniHost(): boolean {
  return role === 'mini-host'
}
