/**
 * 导出 / 导入备份用的文件对话框。
 *
 * 渲染层没有任何文件系统能力（sandbox + contextIsolation），所以选路径与读写都在主进程做，
 * 跨边界只交接「文本内容」—— 不把任意路径的读写能力暴露给页面。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { dialog, type BrowserWindow } from 'electron'

import type { FileOpenResult, FileSaveResult } from '@shared/ipc'

/**
 * 读入内容的体积上限。
 * 备份文件正常只有几十 KB；给个上限是为了「选错文件」时不要把几百兆灌进 IPC 与渲染层。
 */
const MAX_READ_BYTES = 32 * 1024 * 1024

/**
 * 保存对话框的扩展名过滤器，按建议文件名的扩展名挑。
 *
 * 原先写死一个「JSON 备份」—— 那对歌单备份是对的，对导出日志（.log 纯文本）就是在说谎：
 * 下拉里写着 JSON，存的却是日志。
 */
const JSON_FILTER = { name: 'JSON 备份', extensions: ['json'] }

const SAVE_FILTERS: Record<string, { name: string; extensions: string[] }> = {
  json: JSON_FILTER,
  log: { name: '日志文本', extensions: ['log', 'txt'] }
}

const ALL_FILES_FILTER = { name: '所有文件', extensions: ['*'] }

/** 认不出的扩展名就只给「所有文件」：给个对不上的过滤器，比不给更糟 */
function saveFilters(suggestedName: string): { name: string; extensions: string[] }[] {
  const filter = SAVE_FILTERS[extname(suggestedName).slice(1).toLowerCase()]
  return filter ? [filter, ALL_FILES_FILTER] : [ALL_FILES_FILTER]
}

export async function saveTextFile(
  window: BrowserWindow | null,
  suggestedName: string,
  contents: string
): Promise<FileSaveResult> {
  const options = { defaultPath: suggestedName, filters: saveFilters(suggestedName) }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false, path: null }
  await writeFile(result.filePath, contents, 'utf8')
  return { saved: true, path: result.filePath }
}

export async function openTextFile(window: BrowserWindow | null): Promise<FileOpenResult | null> {
  // 打开框目前唯一的用途是导入歌单备份（JSON），所以过滤器就固定成它
  const options = { properties: ['openFile' as const], filters: [JSON_FILTER] }
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options)
  const path = result.filePaths[0]
  if (result.canceled || !path) return null

  const buffer = await readFile(path)
  if (buffer.byteLength > MAX_READ_BYTES) {
    throw new Error(`文件过大（上限 ${MAX_READ_BYTES / 1024 / 1024}MB）`)
  }
  return { name: basename(path), contents: buffer.toString('utf8') }
}
