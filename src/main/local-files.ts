/**
 * 本地文件的**收件口**（主进程侧）。
 *
 * 「用 Songloft Desktop 打开某个音频文件」这件事有三个来源，而它们到达的时刻都很随意：
 *   1. 启动参数（Windows / Linux 的文件关联就是给 argv 追加一个路径）；
 *   2. macOS 的 `open-file` 事件（双击文件启动，或应用已开着时再双击一个）；
 *   3. 用户自己从菜单 / 页面上的「打开文件」挑的。
 *
 * ★ 于是这里用**排队 + 来取**，而不是「收到就推给渲染层」：前两个来源可能发生在渲染层
 *   就绪之前（双击文件启动时，Chromium 还在加载页面），此刻推过去的消息会直接消失 ——
 *   用户双击了文件却什么都没发生，且没有任何报错。排队之后，渲染层开机来取一次、
 *   之后每次收到摇铃再来取，**早到晚到都只处理一次**（取走即清空）。
 *
 * 与 miniIsOpen 是同一条思路：能问就别指望推。
 */

import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import { dialog } from 'electron'
import type { BrowserWindow } from 'electron'

import { AUDIO_EXTENSIONS, pickAudioPaths } from '@shared/local-file'

/** 排着队、等着渲染层来取的路径（取走即清空） */
let pending: string[] = []

/**
 * 最多排多久。
 *
 * ★ 有上限是因为「一次拖进来几百个文件」是可能的，而队列本身是「刚打开过什么」的语义
 *   —— 留下的应当是**最先**那几个（播放会从第一个开始），多出来的丢掉不损失什么。
 */
const MAX_PENDING = 200

/**
 * 「有新文件」该通知谁。
 *
 * 不在这里直接 import 主窗口：那个引用在 index.ts 里，而这里是个叶子模块（菜单也要用
 * 同一个入口）。所以由 index.ts 在启动时接上一根线。
 */
let notifier: (() => void) | null = null

export function setLocalFilesNotifier(fn: (() => void) | null): void {
  notifier = fn
}

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}

/**
 * 把某个参数当成路径看一眼：**必须是真实存在的文件**才认。
 *
 * 为什么不只按扩展名判：argv 里混着别的东西（Electron 自己的开关值、别的程序传的怪参数），
 * 而「文件关联」传进来的路径也完全可能已经失效（用户刚删了它）。认下来一个不存在的路径，
 * 用户看到的是「双击之后界面毫无反应」还是「双击之后提示放不出来」——后者才说得清。
 */
function toExistingFile(candidate: string, cwd: string): string | null {
  const path = isAbsolute(candidate) ? candidate : resolve(cwd, candidate)
  try {
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

/**
 * 从一串命令行参数里挑出**真实存在的音频文件**（去重、保序）。
 *
 * `cwd` 是那一条命令行自己的当前目录：第二次启动时传进来的相对路径，要按**那个进程**的
 * 目录解，而不是主进程的（两个 cwd 完全可能不一样）。
 */
export function pathsFromArgv(argv: readonly string[], cwd = process.cwd()): string[] {
  return dedupe(
    pickAudioPaths(argv)
      .map((arg) => toExistingFile(arg, cwd))
      .filter((path): path is string => path !== null)
  )
}

/** 排进队里（已经在排队或被取走过的，不重复排 —— 同一首歌连着双击两次只该出现一次） */
export function queuePaths(paths: readonly string[]): void {
  if (paths.length === 0) return
  pending = dedupe([...pending, ...paths]).slice(0, MAX_PENDING)
}

/** 取走并清空 */
export function takePendingPaths(): string[] {
  const taken = pending
  pending = []
  return taken
}

/**
 * 收到一批要打开的本地文件：排队 + 摇一下渲染层。
 *
 * 三个入口（启动参数 / macOS 的 open-file / 菜单挑的）都走这一句，于是「怎么通知渲染层」
 * 只有一处实现。摇铃时没有人在听也没关系 —— 那批路径还在队里，渲染层就绪后会来取。
 */
export function announceLocalFiles(paths: readonly string[]): void {
  if (paths.length === 0) return
  queuePaths(paths)
  notifier?.()
}

/** 弹系统文件框挑音频文件；取消时返回空数组 */
export async function openLocalFilesDialog(window: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: '打开本地音频文件',
    buttonLabel: '播放',
    properties: ['openFile', 'multiSelections'],
    filters: [
      // 过滤器的扩展名来自 shared 的那张表：能放出来的才列，放不出来的不在这里哄人
      { name: '音频文件', extensions: [...AUDIO_EXTENSIONS] },
      { name: '全部文件', extensions: ['*'] }
    ]
  }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? [] : dedupe(result.filePaths)
}
