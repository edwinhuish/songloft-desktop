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

function resolveIconPath(): string {
  // 打包后 extraResources 落到 process.resourcesPath/tray.png；
  // 开发态直接读仓库里的 build/tray-256.png。
  const packaged = join(process.resourcesPath ?? '', 'tray.png')
  if (existsSync(packaged)) return packaged
  return join(app.getAppPath(), 'build', 'tray-256.png')
}

export interface TrayDeps {
  onCommand: (command: MediaCommand) => void
  onToggleWindow: () => void
  onQuit: () => void
  isWindowVisible: () => boolean
}

export function createTray(deps: TrayDeps): Tray | null {
  try {
    const image = nativeImage.createFromPath(resolveIconPath())
    if (image.isEmpty()) {
      console.warn('[tray] 图标文件读不出内容，跳过托盘')
      return null
    }
    tray = new Tray(image.resize({ width: 22, height: 22 }))
    tray.setToolTip('Songloft Desktop')
    render(deps, { title: null, artist: null, playing: false, favorite: false })
    tray.on('click', () => deps.onToggleWindow())
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

  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: snapshot.title ? `${snapshot.title}` : '未在播放',
        enabled: false
      },
      { type: 'separator' },
      { label: snapshot.playing ? '暂停' : '播放', click: () => deps.onCommand({ kind: 'play-pause' }) },
      { label: '上一首', click: () => deps.onCommand({ kind: 'previous' }) },
      { label: '下一首', click: () => deps.onCommand({ kind: 'next' }) },
      { type: 'separator' },
      {
        label: snapshot.favorite ? '取消收藏' : '收藏',
        click: () => deps.onCommand({ kind: 'toggle-favorite' })
      },
      {
        label: deps.isWindowVisible() ? '隐藏主窗口' : '显示主窗口',
        click: () => deps.onToggleWindow()
      },
      { type: 'separator' },
      { label: '退出', click: () => deps.onQuit() }
    ])
  )
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
