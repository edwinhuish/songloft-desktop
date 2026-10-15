/**
 * 托盘：显示/隐藏、播放控制、退出。
 *
 * ⚠️ GNOME 原生没有托盘（需要 AppIndicator 扩展）。托盘创建失败**不应该**影响主功能，
 * 所以整体包在 try/catch 里，失败只记一行日志。
 */

import { Menu, Tray, app, nativeImage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { MediaCommand, TraySnapshot } from '@shared/ipc'

let tray: Tray | null = null

/**
 * 托盘图标的候选路径。
 *
 *  打包态：extraResources 把 build/icon-source.png 落到 process.resourcesPath/tray.png
 *  开发态：build/ 不进包，但仓库里这两份都在 —— 优先 256 的托盘专用图，
 *          没有再退回 1024 的位图母版（反正下面会 resize 到 22）。
 *
 * ⚠️ 早先这里只写死 build/tray-256.png，而 make-icons.sh 并不产出该文件，
 *    结果开发态托盘**必然**静默失败（只有一行 warn），很容易被当成"GNOME 没托盘"而误判。
 *    所以改成按序试多份，且最后一份是必然存在的母版。
 */
function resolveIconPath(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'tray.png'),
    join(app.getAppPath(), 'build', 'tray-256.png'),
    join(app.getAppPath(), 'build', 'icon-source.png')
  ]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

export interface TrayDeps {
  /** 播放控制（播放/暂停、上一首、下一首、收藏）：由调用方转给**当宿主的那一个窗口** */
  onCommand: (command: MediaCommand) => void
  /** 点托盘图标（左键）：把本趟会话的窗口叫回来 */
  onActivate: () => void
  /**
   * 「显示 / 隐藏……」那一项。返回 null 就**整项不出现**。
   *
   * ★ 为什么由调用方给、而不是在这里读窗口：**本地文件会话**里没有主窗口（迷你条自己就是
   *   全部界面，见 main/index.ts 的 localSession）—— 那一趟摆一项「显示主窗口」只会把人引到
   *   一个永远不会出现的窗口上。标签也由调用方算：它才知道哪个窗口算数、
   *   而菜单是每次推送播放状态时重建的，所以每次读到的都是此刻的可见性。
   */
  windowItem: () => { label: string; click: () => void } | null
  onQuit: () => void
}

export function createTray(deps: TrayDeps): Tray | null {
  try {
    const iconPath = resolveIconPath()
    if (!iconPath) {
      console.warn('[tray] 找不到托盘图标（build/icon-source.png 缺失？），跳过托盘')
      return null
    }
    const image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      console.warn('[tray] 图标读不出像素内容，跳过托盘：', iconPath)
      return null
    }
    tray = new Tray(image.resize({ width: 22, height: 22 }))
    tray.setToolTip('Songloft Desktop')
    render(deps, { title: null, artist: null, playing: false, favorite: false })
    tray.on('click', () => deps.onActivate())
    return tray
  } catch (error) {
    console.warn('[tray] 创建失败（GNOME 下需要 AppIndicator 扩展），继续运行', error)
    return null
  }
}

export function render(deps: TrayDeps, snapshot: TraySnapshot): void {
  if (!tray) return
  const label = snapshot.title
    ? `${snapshot.playing ? '▶' : '⏸'} ${snapshot.title}${snapshot.artist ? ` — ${snapshot.artist}` : ''}`
    : 'Songloft Desktop'
  tray.setToolTip(label)

  const items: Electron.MenuItemConstructorOptions[] = [
    {
      label: snapshot.title ? `${snapshot.title}` : '未在播放',
      enabled: false
    },
    { type: 'separator' },
    {
      label: snapshot.playing ? '暂停' : '播放',
      click: () => deps.onCommand({ kind: 'play-pause' })
    },
    { label: '上一首', click: () => deps.onCommand({ kind: 'previous' }) },
    { label: '下一首', click: () => deps.onCommand({ kind: 'next' }) },
    { type: 'separator' },
    {
      label: snapshot.favorite ? '取消收藏' : '收藏',
      click: () => deps.onCommand({ kind: 'toggle-favorite' })
    }
  ]

  /* 本地文件会话里没有这一项（见 TrayDeps.windowItem 的说明） */
  const windowItem = deps.windowItem()
  if (windowItem) {
    items.push({ label: windowItem.label, click: windowItem.click }, { type: 'separator' })
  }

  items.push({ label: '退出', click: () => deps.onQuit() })
  tray.setContextMenu(Menu.buildFromTemplate(items))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
