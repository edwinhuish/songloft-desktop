/**
 * 把 DevTools 装进我们自己的窗口里。
 *
 * 为什么不直接用 Electron 默认的 DevTools 窗口：那个窗口带系统装饰，它的**阴影会被反复
 * 重绘并留在屏幕上**（越积越多，像一层层叠影）。这是合成器层面的毛病，应用侧只有一条出路 ——
 * 别让它用带装饰的窗口：自己建一个无边框 BrowserWindow，用 setDevToolsWebContents 把
 * DevTools 的渲染进程接过去，再 openDevTools({ mode: 'detach' })。顺序不能反：先接
 * webContents，DevTools 才会渲染进那个窗口。
 *
 * `hasShadow: false` 只有 macOS 认，其余平台忽略；跨平台真正起作用的是 `frame: false`
 * （阴影来自装饰）。两个都写上是为了三处口径一致。
 *
 * 代价：无边框 = 没有标题栏，鼠标拖不了也关不了这个窗口，只能靠 Alt+F4 / 菜单里的
 * Ctrl+Shift+I。它只出现在开发态（打包态仍走 Electron 自带窗口），这样换掉一层叠影是划算的。
 */

import { BrowserWindow } from 'electron'

/** 当前承载 DevTools 的窗口；null = DevTools 没开 */
let host: BrowserWindow | null = null

function createHost(owner: BrowserWindow): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    frame: false,
    hasShadow: false,
    // 跟主窗口绑定：主窗口关掉它跟着走（不会剩一个「只有 DevTools」的窗口把应用吊住），
    // 平时也不会跑到主窗口后面去
    parent: owner,
    title: '开发者工具',
    autoHideMenuBar: true
    // webPreferences 一律用默认：DevTools 前端本身就是个普通页面，
    // 不该给它任何额外能力（默认的 contextIsolation / sandbox 就是我们要的）
  })

  // 用户关掉这个窗口 = 关掉 DevTools。两块状态必须一起收，
  // 否则下一次 toggle 会以为「已经开着」而什么都不做
  window.on('closed', () => {
    if (host === window) host = null
    if (!owner.isDestroyed() && owner.webContents.isDevToolsOpened())
      owner.webContents.closeDevTools()
  })

  // 反过来：DevTools 被别的路径关掉（同一族的 closeDevTools）时，窗口也要收掉
  owner.webContents.once('devtools-closed', () => {
    if (!window.isDestroyed()) window.destroy()
  })

  return window
}

export function openHostedDevTools(owner: BrowserWindow): void {
  const window = host && !host.isDestroyed() ? host : createHost(owner)
  host = window
  window.show()
  window.focus()
  // ★ 顺序：先 setDevToolsWebContents，再 openDevTools
  owner.webContents.setDevToolsWebContents(window.webContents)
  owner.webContents.openDevTools({ mode: 'detach' })
}

export function toggleHostedDevTools(owner: BrowserWindow): void {
  if (owner.webContents.isDevToolsOpened()) {
    // 窗口会由 devtools-closed 那条监听收掉
    owner.webContents.closeDevTools()
    return
  }
  openHostedDevTools(owner)
}
