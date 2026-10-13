/**
 * 导出 / 导入备份用的文件对话框。
 *
 * 渲染层没有任何文件系统能力（sandbox + contextIsolation），所以选路径与读写都在主进程做，
 * 跨边界只交接「文本内容」—— 不把任意路径的读写能力暴露给页面。
 */

import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { dialog, type BrowserWindow } from 'electron'

import type { FileOpenResult, FileSaveResult } from '@shared/ipc'

/**
 * 读入内容的体积上限。
 * 备份文件正常只有几十 KB；给个上限是为了「选错文件」时不要把几百兆灌进 IPC 与渲染层。
 */
const MAX_READ_BYTES = 32 * 1024 * 1024

const JSON_FILTERS = [{ name: 'JSON 备份', extensions: ['json'] }]

export async function saveTextFile(
  window: BrowserWindow | null,
  suggestedName: string,
  contents: string
): Promise<FileSaveResult> {
  const options = { defaultPath: suggestedName, filters: JSON_FILTERS }
  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { saved: false, path: null }
  await writeFile(result.filePath, contents, 'utf8')
  return { saved: true, path: result.filePath }
}

export async function openTextFile(window: BrowserWindow | null): Promise<FileOpenResult | null> {
  const options = { properties: ['openFile' as const], filters: JSON_FILTERS }
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
