/**
 * 桌面端偏好设置。
 *
 * 落在主进程的 config.json（经 preload 白名单读写），同时把「影响外观的几项」
 * 同步到 :root 的 CSS 变量上 —— 主题、密度、强调色、玻璃强度、**主窗与迷你窗各自的
 * 整窗不透明度**，以及歌词区域那层底色与歌词字体颜色都靠这一步生效。
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
  /**
   * 收下**别的窗口**改出来的设置（主进程推来的 settings:changed）。
   *
   * 两个窗口各有一份 settings，而主题 / 强调色 / 两份整窗浓度都是「一改就该两处同时变」
   * 的东西 —— 少了这一条，主窗口换主题时迷你条还停在旧主题上。
   */
  apply: (settings: AppSettings) => void
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
  /*
   * ★ `--glass` 传的是**无单位数字**（0–100），不是百分比 —— 单位由样式表在使用处补：
   *   模糊要 `* 0.28px`、color-mix 占比要 `* 0.7%`（见 tokens.css 那一小节的说明）。
   *   这里若自作主张补上 `%`，那两条 calc 反而双双非法，玻璃底色与模糊会一起静默失效。
   */
  root.style.setProperty('--glass', String(settings.glassIntensity))

  /*
   * 两个**整窗**浓度：主窗一个、迷你窗一个 —— 它们喂给 body 的 opacity
   * （styles/base.css），配合主进程那个透明窗口，整个客户端一起透出后面的桌面。
   * ★ 传 0–1 而不是百分比：直接作为 opacity 的值用，而 opacity 吃的是 alpha 值。
   * ★ 各写各的、不合成一个：两种形态想要的通透程度本来就不同（见 shared/ipc.ts）。
   *   至于「哪一条生效」由样式表按 <html> 的 data-mini 标记分开挑 —— 迷你窗与主窗是
   *   同一个 BrowserWindow、同一棵树，不在变量这一层分。
   */
  root.style.setProperty('--window-opacity', String(settings.windowOpacity / 100))
  root.style.setProperty('--mini-window-opacity', String(settings.miniWindowOpacity / 100))

  /*
   * 迷你窗面板那层底色：传**百分比**（样式表里用 color-mix 的占比，见 tokens.css）。
   * 它是相对播放条那层底色的浓度，100 = 与播放条完全一致 —— 深浅两个主题下都成立，
   * 所以不必（也不能）按主题给两套默认值。
   */
  root.style.setProperty('--mini-panel-opacity', `${settings.miniPanelOpacity}%`)

  /* 歌词区域自己那层底色：与上面两项互不相干，也不参与整窗浓度（见 shared/ipc.ts） */
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

  apply: (settings) => {
    set({ settings, loaded: true })
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
