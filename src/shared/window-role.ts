/**
 * 「这个渲染进程是哪种窗口」——主进程与渲染层之间的一份极小契约。
 *
 * 两个窗口加载的是**同一个入口文件**，只有 URL 的 hash 不同（见 main/mini-window.ts），
 * 所以「我是谁」只能靠 hash 认。而迷你窗有**两种身份**，这是本模块存在的原因：
 *
 *   · `mini`      —— 迷你窗 · **跟随者**：主窗口持有播放，它只显示镜像、把动作发回去；
 *   · `mini-host` —— 迷你窗 · **宿主**：它自己就是播放器（本地文件会话，见 AGENTS.md
 *                    「本地文件会话」那一节）。这一档没有主窗口。
 *
 * ★ 为什么要把这份口径抽到 shared：hash 是**两侧共同**的东西 —— 主进程写它、渲染层读它，
 *   各写一遍字符串就是将来某次改名里那个「一半新一半旧」的静默错配（症状是迷你窗用镜像
 *   的姿势去当宿主，一行也放不出来）。类型 + 常量在这里给出，两边都从这里取。
 *
 * ★ 不要靠「主进程有没有主窗口」来判：渲染层问不到这件事，而且它答的是**此刻**，
 *   窗口角色从加载那一刻就定了（见 renderer/state/usePlayer 那句模块级分流）。
 */

export type WindowRole =
  /** 主窗口：完整界面，播放的宿主（有会话时也是它） */
  | 'main'
  /** 迷你窗 · 跟随者：镜像主窗口的播放状态 */
  | 'mini'
  /** 迷你窗 · 宿主：本地文件会话里它自己就是播放器 */
  | 'mini-host'

/**
 * 各角色对应的 hash（**不带前导 #**）。
 *
 * 两种用法都由它们拼出来：
 *   · 打包态 `loadFile(…, { hash })` —— Electron 自己补 `#`；
 *   · 开发态 `loadURL(ELECTRON_RENDERER_URL + '#' + hash)`。
 */
export const WINDOW_HASHES = {
  main: '',
  mini: 'mini',
  'mini-host': 'mini-host'
} as const satisfies Record<WindowRole, string>

/** hash（**不带前导 #**；空串也算主窗口）→ 角色 */
export function roleFromHash(hash: string): WindowRole {
  const clean = hash.replace(/^#/, '')
  if (clean === WINDOW_HASHES['mini-host']) return 'mini-host'
  if (clean === WINDOW_HASHES.mini) return 'mini'
  return 'main'
}

/** 角色 → loadFile / loadURL 用的那一段 hash（主窗口是空串） */
export function hashForRole(role: WindowRole): string {
  return WINDOW_HASHES[role]
}
