/**
 * 应用菜单。
 *
 * 窗口是无边框的，菜单栏看不见 —— 但它仍然提供**全局加速键**（F11 全屏、
 * Ctrl+Shift+I 开发者工具、Ctrl+Q 退出…），这些键需要在渲染层之外也能生效，
 * 所以菜单还是要挂上。
 *
 * 播放相关快捷键（空格、方向键…）不在这里，交给渲染层的 keydown 处理：
 * 那些键有上下文（输入框聚焦时不该触发），放在主进程会失去上下文判断。
 */

import { Menu, app, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { REPO_URL, UPSTREAM_URL } from '@shared/links'
import { toggleHostedDevTools } from './devtools'

export function installAppMenu(getWindow: () => BrowserWindow | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '设置',
          accelerator: 'CmdOrCtrl+,',
          click: () => getWindow()?.webContents.send(IPC.onNavigate, '/settings')
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        {
          label: '开发者工具',
          accelerator: 'CmdOrCtrl+Shift+I',
          // 不用 role: 'toggleDevTools' —— 那会用 Electron 自带的 DevTools 窗口，
          // 它的阴影会不断累积（见 devtools.ts）。打包态例外：那边按到快捷键的用户
          // 更需要一个能正常拖、正常关的窗口。
          click: () => {
            const window = getWindow()
            if (!window) return
            if (app.isPackaged) window.webContents.toggleDevTools()
            else toggleHostedDevTools(window)
          }
        },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '本仓库（songloft-desktop）',
          click: () => void shell.openExternal(REPO_URL)
        },
        {
          label: '原项目（songloft-player）',
          click: () => void shell.openExternal(UPSTREAM_URL)
        },
        { type: 'separator' },
        {
          label: '打开配置目录',
          click: () => void shell.openPath(app.getPath('userData'))
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
