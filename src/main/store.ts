/**
 * 本地持久化：一份 JSON，落在 app.getPath('userData')。
 *
 * 为什么放主进程而不是 localStorage：
 *   1. 凭据（access/refresh token）不该躺在渲染层的存储里；
 *   2. 多个服务器要各自隔离凭据（walletKey = 规范化后的服务器 URL），
 *      这份映射需要一个稳定、可原子写的地方。
 *
 * 写盘一律「临时文件 + rename」，避免掉电/崩溃留下半截 JSON 把配置读挂。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { DEFAULT_SETTINGS, type AppSettings, type ServerEntry } from '@shared/ipc'
import type { StoredCredentials } from '@shared/bridge-types'

export type { StoredCredentials }

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

interface ConfigFile {
  schema: 1
  settings: AppSettings
  servers: ServerEntry[]
  credentials: Record<string, StoredCredentials>
  window: WindowBounds
}

const DEFAULT_WINDOW: WindowBounds = { width: 1440, height: 920, maximized: false }

/** 与 Flutter 端 SecureStorageService.walletKey 同义：按服务器 URL 隔离凭据 */
export function walletKeyFor(url: string): string {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.host}`
  } catch {
    return url.trim().replace(/\/+$/, '')
  }
}

function emptyConfig(): ConfigFile {
  return {
    schema: 1,
    settings: { ...DEFAULT_SETTINGS },
    servers: [],
    credentials: {},
    window: { ...DEFAULT_WINDOW }
  }
}

export class ConfigStore {
  private readonly file: string
  private data: ConfigFile

  constructor(fileName = 'config.json') {
    this.file = join(app.getPath('userData'), fileName)
    this.data = this.load()
  }

  private load(): ConfigFile {
    try {
      if (!existsSync(this.file)) return emptyConfig()
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<ConfigFile>
      // 逐段回退：任何一段坏掉都不该让整个配置失效。
      return {
        schema: 1,
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        servers: Array.isArray(raw.servers) ? raw.servers.filter((s) => s && typeof s.url === 'string') : [],
        credentials: raw.credentials && typeof raw.credentials === 'object' ? raw.credentials : {},
        window: { ...DEFAULT_WINDOW, ...(raw.window ?? {}) }
      }
    } catch (error) {
      console.error('[store] 配置读取失败，回退到默认值', error)
      return emptyConfig()
    }
  }

  private persist(): void {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }

  // ── settings ───────────────────────────────────────────────────────────
  getSettings(): AppSettings {
    return { ...this.data.settings }
  }

  patchSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.persist()
    return this.getSettings()
  }

  resetSettings(): AppSettings {
    this.data.settings = { ...DEFAULT_SETTINGS }
    this.persist()
    return this.getSettings()
  }

  // ── servers ────────────────────────────────────────────────────────────
  listServers(): ServerEntry[] {
    return this.data.servers.map((s) => ({ ...s }))
  }

  upsertServer(entry: ServerEntry): ServerEntry[] {
    const key = walletKeyFor(entry.url)
    const next = this.data.servers.filter((s) => walletKeyFor(s.url) !== key)
    next.unshift({ ...entry, url: key })
    this.data.servers = next
    this.persist()
    return this.listServers()
  }

  removeServer(url: string): ServerEntry[] {
    const key = walletKeyFor(url)
    this.data.servers = this.data.servers.filter((s) => walletKeyFor(s.url) !== key)
    delete this.data.credentials[key]
    this.persist()
    return this.listServers()
  }

  // ── credentials ────────────────────────────────────────────────────────
  getCredentials(url: string): StoredCredentials | null {
    return this.data.credentials[walletKeyFor(url)] ?? null
  }

  setCredentials(url: string, creds: Omit<StoredCredentials, 'savedAt'>): void {
    this.data.credentials[walletKeyFor(url)] = { ...creds, savedAt: Date.now() }
    this.persist()
  }

  clearCredentials(url: string): void {
    delete this.data.credentials[walletKeyFor(url)]
    this.persist()
  }

  // ── window ─────────────────────────────────────────────────────────────
  getWindowBounds(): WindowBounds {
    return { ...this.data.window }
  }

  saveWindowBounds(bounds: Partial<WindowBounds>): void {
    this.data.window = { ...this.data.window, ...bounds }
    this.persist()
  }
}
