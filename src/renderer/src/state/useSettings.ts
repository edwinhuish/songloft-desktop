/**
 * 桌面端偏好设置。
 *
 * 落在主进程的 config.json（经 preload 白名单读写），同时把「影响外观的几项」
 * 同步到 :root 的 CSS 变量上 —— 主题、密度、强调色、玻璃强度，以及三处底色的
 * 不透明度（主播放器 / 迷你播放器 / 歌词区域）与歌词字体颜色都靠这一步生效。
 *
 * ▶ UI 优化的一个关键点：强调色默认跟随封面取色（accentFromCover）。
 *   播放一首歌时界面光晕与按钮颜色会平滑过渡到封面主色，这是原 Flutter 端
 *   （只在播放器页做渐变）做不到的整页级联动。
 */

import { create } from 'zustand'

import { DEFAULT_SETTINGS, type AppSettings } from '@shared/ipc'
import { readableTextOn } from '@/lib/color'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  /** 当前由封面推导出的强调色（null = 用设置里的固定色） */
  coverAccent: string | null

  load: () => Promise<void>
  patch: (patch: Partial<AppSettings>) => Promise<void>
  reset: () => Promise<void>
  setCoverAccent: (hex: string | null) => void
}

function applyToDocument(settings: AppSettings, coverAccent: string | null): void {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const theme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme
  root.dataset.theme = theme
  root.dataset.density = settings.density

  const accent = settings.accentFromCover && coverAccent ? coverAccent : settings.accent
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--on-accent', readableTextOn(accent))
  root.style.setProperty('--glass', String(settings.glassIntensity))

  /*
   * 三处「底色浓度」：主播放器、迷你播放器、歌词区域各一个，全部是绝对值（%）。
   * ★ 各写各的，不合成一个变量 —— 这三项要的就是「调一个不动另外两个」，
   *   一旦共用，它们的独立性就没了（见 shared/ipc.ts 里 playerOpacity 的说明）。
   */
  root.style.setProperty('--player-opacity', `${settings.playerOpacity}%`)
  root.style.setProperty('--mini-opacity', `${settings.miniOpacity}%`)
  root.style.setProperty('--lyric-panel-opacity', `${settings.lyricPanelOpacity}%`)

  /*
   * 歌词文字：颜色与不透明度分开给。
   * ★ 不透明度传的是 0–1（而不是 %），因为样式表里要拿它**乘**各档浓度
   *   （`calc(28% * var(--lyric-fg-alpha))`）—— 百分比之间不能相乘。
   * ★ 颜色为空时回落到主题的文字色，这样「跟随主题」在深浅两种主题下都对得上。
   */
  root.style.setProperty('--lyric-fg', settings.lyricFontColor || 'var(--text-1)')
  root.style.setProperty('--lyric-fg-alpha', String(settings.lyricFontOpacity / 100))
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  coverAccent: null,

  load: async () => {
    const settings = await window.songloft.settings.get()
    set({ settings, loaded: true })
    applyToDocument(settings, get().coverAccent)
  },

  patch: async (patch) => {
    const settings = await window.songloft.settings.patch(patch)
    set({ settings })
    applyToDocument(settings, get().coverAccent)
  },

  reset: async () => {
    const settings = await window.songloft.settings.reset()
    set({ settings })
    applyToDocument(settings, get().coverAccent)
  },

  setCoverAccent: (hex) => {
    set({ coverAccent: hex })
    applyToDocument(get().settings, hex)
  }
}))

/** 系统主题变化时重新套用（theme = 'system' 才需要） */
export function watchSystemTheme(): () => void {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = (): void => {
    const { settings, coverAccent } = useSettings.getState()
    if (settings.theme === 'system') applyToDocument(settings, coverAccent)
  }
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

export function currentAccentHex(): string {
  const { settings, coverAccent } = useSettings.getState()
  return settings.accentFromCover && coverAccent ? coverAccent : settings.accent
}
