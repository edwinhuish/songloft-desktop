/**
 * 「我现在跑在哪个窗口里」。
 *
 * 两个窗口（主窗口 / 迷你窗）加载的是**同一个入口文件**，只有 URL 的 hash 不同
 * （主进程那边 loadURL/loadFile 时带 `#mini`，见 main/mini-window.ts）。
 * 于是渲染层有两处要按它分流：
 *   · main.tsx —— 挂 App 还是挂 MiniApp；
 *   · state/usePlayer.ts —— 用真播放器还是用主窗口那份镜像。
 *
 * ★ 为什么不做成两份 HTML 入口：那样要复制一套 index.html 与构建配置，而两者的差别只有
 *   一个 hash 那么点 —— 多一个入口就是多一处要记得跟着改的地方。
 */

export function isMiniWindow(): boolean {
  return window.location.hash === '#mini'
}
