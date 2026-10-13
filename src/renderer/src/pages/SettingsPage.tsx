/**
 * 设置。
 *
 * 分成「本地偏好」与「服务端设置」两类，并在界面上明确分区 —— 这一区分很重要：
 * 主题/歌词字号是本机的，改了不影响别的设备；音乐目录/扫描策略是服务端的，改了对所有客户端生效。
 * 原 Flutter 端把两类混在同一个长列表里，用户改完不知道到底改了谁。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppInfo, ServerProbeResult } from '@shared/ipc'
import { REPO_URL, UPSTREAM_URL } from '@shared/links'
import type {
  AutoScanSetting,
  DuplicatesResult,
  FailedFingerprint,
  FingerprintProgress,
  MetadataRefreshProgress,
  MetadataRefreshStatus,
  MusicPathSetting,
  PlaylistMode,
  ScanProgress,
  ScanTitleSource,
  TokenInfo
} from '@shared/types'
import { useContextMenu, type MenuItem } from '@/components/ContextMenu'
import { ExcludeDirsEditor } from '@/components/ExcludeDirsEditor'
import {
  IconAlert,
  IconCheck,
  IconChevronDown,
  IconEyeOff,
  IconExternal,
  IconFingerprint,
  IconLoader,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconRefresh,
  IconServer,
  IconSliders,
  IconSparkle,
  IconSun,
  IconTrash
} from '@/components/Icons'
import { Modal } from '@/components/Modal'
import { EmptyState, Switch } from '@/components/primitives'
import { SettingSelect, type SelectOption } from '@/components/SettingSelect'
import {
  cancelFingerprintCompute,
  cancelMetadataRefresh,
  cancelScan,
  cleanMissingSongs,
  computeFingerprints,
  deleteSong,
  findDuplicates,
  getAutoScan,
  getFailedFingerprints,
  getFingerprintProgress,
  getFingerprintStatus,
  getHlsProxyEnabled,
  getMetadataRefreshProgress,
  getMusicPath,
  getRemoteTitleSource,
  getScanProgress,
  getScanAutoCreatePlaylists,
  getScanAutoFingerprint,
  getScanPlaylistMode,
  getScanTitleSource,
  getTagSyncToFile,
  getTokens,
  getVolumeNormalize,
  revokeToken,
  setAutoScan,
  setHlsProxyEnabled,
  setRemoteTitleSource,
  setScanAutoCreatePlaylists,
  setScanAutoFingerprint,
  setScanPlaylistMode,
  setScanTitleSource,
  setTagSyncToFile,
  setVolumeNormalize,
  startMetadataRefresh,
  startScan,
  updateMusicPath
} from '@/api/endpoints'
import { useAsync } from '@/hooks/useAsync'
import { formatBytes, formatDate, formatRelative } from '@/lib/format'
import { requireClient, useAuth } from '@/state/useAuth'
import { currentAccentHex, useSettings } from '@/state/useSettings'
import { useUi, type SettingsSection } from '@/state/useUi'
import { toast } from '@/state/useToasts'

const SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'playback', label: '播放与歌词' },
  { key: 'library', label: '曲库与扫描' },
  { key: 'server', label: '服务器' },
  { key: 'account', label: '账号' },
  { key: 'about', label: '关于' }
]

const ACCENT_PRESETS = ['#7c5cff', '#22a7d6', '#ee5a8a', '#f08a3c', '#3fb27f', '#c9c2b6']

export function SettingsPage({ section }: { section: SettingsSection }): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">设置</h1>
          <p className="page-subtitle">带「服务端」标志的项会影响所有连接到同一后端的设备</p>
        </div>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          {SECTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-current={section === item.key}
              onClick={() => navigate({ name: 'settings', section: item.key })}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div>
          {section === 'appearance' ? <AppearanceSettings /> : null}
          {section === 'playback' ? <PlaybackSettings /> : null}
          {section === 'library' ? <LibrarySettings /> : null}
          {section === 'server' ? <ServerSettings /> : null}
          {section === 'account' ? <AccountSettings /> : null}
          {section === 'about' ? <AboutSettings /> : null}
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────────── 通用行 ───────────────────────────── */

interface RowProps {
  /** ReactNode 而非 string：账号页要在标题后面缀「版本 · 耗时」或红色的「断开链接」 */
  title: React.ReactNode
  desc?: React.ReactNode
  /** 该项是服务端设置（对所有设备生效） */
  server?: boolean
  /** 子选项：从属于上一行，左缩进 + 竖线标出这层关系 */
  nested?: boolean
  /**
   * 正文落到标题下方、占满整行（排除目录编辑器、扫描按钮区这类宽内容）。
   * 这时右侧控件要从 `control` 给 —— `children` 已经被正文占用了。
   */
  block?: boolean
  /** 右侧控件。与 block 搭配时它仍留在标题行右侧（开关/展开按钮属于标题，不属于正文） */
  control?: React.ReactNode
  /**
   * 给了它就整行标题区可点（展开/收起这类）。这时**不要**再在 control 里放按钮：
   * 按钮套在可点区里，一次点击会触发两遍（先冒泡到行上、再执行按钮自己的 onClick）。
   * 右侧改用 `.collapse-hint` 那种纯展示的提示。
   */
  onToggle?: () => void
  /** 配合 onToggle：把展开态说给读屏；状态本身由外面持有 */
  expanded?: boolean
  children?: React.ReactNode
}

function Row({
  title,
  desc,
  server,
  nested,
  block,
  control,
  onToggle,
  expanded,
  children
}: RowProps): React.JSX.Element {
  // 非 block 行的 children 就是右侧控件（设置页的历史写法），block 行才是正文
  const trailing = control ?? (block ? null : children)
  const clickable = onToggle !== undefined

  return (
    <div
      className="setting-row"
      data-nested={nested ? 'true' : undefined}
      data-block={block ? 'true' : undefined}
    >
      <div
        className="setting-row-head"
        data-clickable={clickable ? 'true' : undefined}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={clickable ? expanded : undefined}
        onClick={onToggle}
        onKeyDown={
          clickable
            ? (event) => {
                // div 扮按钮就得自己补键盘：空格还得挡掉默认的翻页滚动
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onToggle?.()
              }
            : undefined
        }
      >
        <div className="setting-row-text">
          <div className="setting-row-title">
            {title}
            {server ? (
              <span className="badge" data-tone="accent" style={{ marginLeft: 8 }}>
                服务端
              </span>
            ) : null}
          </div>
          {desc ? <div className="setting-row-desc">{desc}</div> : null}
        </div>
        {trailing ? <div className="setting-row-control">{trailing}</div> : null}
      </div>
      {block && children ? <div className="setting-row-body">{children}</div> : null}
    </div>
  )
}

interface CardProps {
  title: string
  /** 标题右侧的操作区（例如计数与刷新），与标题同一行 */
  action?: React.ReactNode
  children: React.ReactNode
}

function Card({ title, action, children }: CardProps): React.JSX.Element {
  return (
    <section className="setting-card">
      <div className="setting-card-title">
        {title}
        {action ? <div className="setting-card-actions">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/* ───────────────────────────── 外观 ───────────────────────────── */

function AppearanceSettings(): React.JSX.Element {
  const { settings, patch, reset, coverAccent } = useSettings()
  const accent = currentAccentHex()

  return (
    <>
      <Card title="主题">
        <Row title="配色模式" desc="跟随系统时会随 GNOME 的浅色/深色偏好实时切换">
          <div className="segmented" role="group" aria-label="配色模式">
            {[
              { value: 'system' as const, label: '跟随系统', icon: <IconMonitor size={14} /> },
              { value: 'dark' as const, label: '深色', icon: <IconMoon size={14} /> },
              { value: 'light' as const, label: '浅色', icon: <IconSun size={14} /> }
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={settings.theme === option.value}
                onClick={() => void patch({ theme: option.value })}
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>
        </Row>

        <Row
          title="强调色跟随封面"
          desc={
            coverAccent
              ? `当前由封面推导：${coverAccent} —— 换歌时整页光晕会平滑过渡`
              : '播放时从封面提取主色，让界面色调跟着专辑走'
          }
        >
          <Switch
            ariaLabel="强调色跟随封面"
            checked={settings.accentFromCover}
            onChange={(checked) => void patch({ accentFromCover: checked })}
          />
        </Row>

        <Row title="固定强调色" desc="关闭「跟随封面」后生效">
          <div className="row" style={{ gap: 6 }}>
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                aria-label={`使用强调色 ${preset}`}
                data-tip={preset}
                onClick={() => void patch({ accent: preset, accentFromCover: false })}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 8,
                  border:
                    accent.toLowerCase() === preset
                      ? '2px solid var(--text-1)'
                      : '1px solid var(--line-2)',
                  background: preset,
                  cursor: 'pointer'
                }}
              />
            ))}
            <input
              type="color"
              aria-label="自定义强调色"
              value={settings.accent}
              onChange={(event) =>
                void patch({ accent: event.target.value, accentFromCover: false })
              }
              style={{
                width: 34,
                height: 26,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer'
              }}
            />
          </div>
        </Row>

        <Row title="界面密度" desc="紧凑模式会把列表行高压到 34px，一屏多看几首">
          <div className="segmented" role="group" aria-label="界面密度">
            <button
              type="button"
              aria-pressed={settings.density === 'comfortable'}
              onClick={() => void patch({ density: 'comfortable' })}
            >
              舒适
            </button>
            <button
              type="button"
              aria-pressed={settings.density === 'compact'}
              onClick={() => void patch({ density: 'compact' })}
            >
              紧凑
            </button>
          </div>
        </Row>

        <Row title="玻璃质感强度" desc={`侧栏与标题栏的模糊程度：${settings.glassIntensity}`}>
          <input
            type="range"
            min={0}
            max={100}
            value={settings.glassIntensity}
            aria-label="玻璃质感强度"
            onChange={(event) => void patch({ glassIntensity: Number(event.target.value) })}
            style={{ width: 180 }}
          />
        </Row>
      </Card>

      <Card title="重置">
        <Row title="恢复默认设置" desc="只重置本机偏好，不会动服务器上的任何数据">
          <button
            type="button"
            className="btn"
            data-variant="danger"
            onClick={() => {
              if (window.confirm('恢复全部本机设置为默认值？')) void reset()
            }}
          >
            <IconRefresh size={15} />
            恢复默认
          </button>
        </Row>
      </Card>
    </>
  )
}

/* ───────────────────────────── 播放与歌词 ───────────────────────────── */

function PlaybackSettings(): React.JSX.Element {
  const { settings, patch } = useSettings()

  const normalize = useAsync(() => getVolumeNormalize(requireClient()), [])
  const hls = useAsync(() => getHlsProxyEnabled(requireClient()), [])

  // 「音量均衡」的开关在服务端，本机的 volumeNormalize 只是它的镜像 ——
  // 音频 URL 由 audio 元素直接请求，拼装时没机会再问一次服务端。
  // 所以服务端状态一到（或被别的设备改过）就把本机对齐，两处不再各说各话。
  const serverNormalize = normalize.data?.enabled
  useEffect(() => {
    if (serverNormalize === undefined || serverNormalize === settings.volumeNormalize) return
    void patch({ volumeNormalize: serverNormalize })
  }, [serverNormalize, settings.volumeNormalize, patch])

  return (
    <>
      <Card title="播放">
        <Row title="默认音量" desc={`新会话的初始音量：${Math.round(settings.volume * 100)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(settings.volume * 100)}
            aria-label="默认音量"
            onChange={(event) => void patch({ volume: Number(event.target.value) / 100 })}
            style={{ width: 180 }}
          />
        </Row>

        <Row title="播放模式" desc="关掉窗口重开后沿用">
          <select
            className="input"
            style={{ width: 150 }}
            value={settings.playMode}
            onChange={(event) =>
              void patch({ playMode: event.target.value as typeof settings.playMode })
            }
          >
            <option value="order">顺序播放</option>
            <option value="loop">列表循环</option>
            <option value="single">单曲循环</option>
            <option value="random">随机播放</option>
          </select>
        </Row>

        <Row title="音质上限" desc="只有后端配了对应转码等级才有效；「原始」表示不做任何处理">
          <select
            className="input"
            style={{ width: 150 }}
            value={settings.quality}
            onChange={(event) =>
              void patch({ quality: event.target.value as typeof settings.quality })
            }
          >
            <option value="original">原始</option>
            <option value="320">320 kbps</option>
            <option value="192">192 kbps</option>
            <option value="128">128 kbps</option>
          </select>
        </Row>

        <Row title="关闭窗口时最小化到托盘" desc="开启后窗口不会退出，托盘图标继续控制播放">
          <Switch
            ariaLabel="关闭窗口时最小化到托盘"
            checked={settings.closeToTray}
            onChange={(checked) => void patch({ closeToTray: checked })}
          />
        </Row>

        <Row
          server
          title="音量均衡"
          desc="启用 EBU R128 响度均衡，消除不同音源之间的音量差异。需要 ffmpeg，会增加 CPU 和首次播放延迟"
        >
          {normalize.loading ? (
            <IconLoader size={16} />
          ) : (
            <Switch
              ariaLabel="音量均衡"
              checked={normalize.data?.enabled ?? false}
              onChange={(checked) => {
                void setVolumeNormalize(requireClient(), {
                  enabled: checked,
                  loudness: normalize.data?.loudness ?? -16
                })
                  // 本机镜像一起写：不然要等下一次拉设置才跟上，中间这段时间
                  // 界面已经是「开」，音频 URL 里却没带 normalize=1
                  .then(() => patch({ volumeNormalize: checked }))
                  .then(() => normalize.reload())
                  .then(() => toast(checked ? '已开启音量均衡' : '已关闭音量均衡', 'success'))
                  .catch((error: unknown) =>
                    toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
                  )
              }}
            />
          )}
        </Row>

        <Row server title="HLS 代理" desc="播放 m3u8 时由服务端代理切片，解决跨域与防盗链">
          {hls.loading ? (
            <IconLoader size={16} />
          ) : (
            <Switch
              ariaLabel="HLS 代理"
              checked={hls.data ?? false}
              onChange={(checked) => {
                void setHlsProxyEnabled(requireClient(), checked)
                  .then(() => hls.reload())
                  .catch((error: unknown) =>
                    toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
                  )
              }}
            />
          )}
        </Row>
      </Card>

      <Card title="歌词">
        <Row title="歌词字号" desc={`${settings.lyricFontSize}px（歌词面板与抽屉同步）`}>
          <input
            type="range"
            min={16}
            max={48}
            value={settings.lyricFontSize}
            aria-label="歌词字号"
            onChange={(event) => void patch({ lyricFontSize: Number(event.target.value) })}
            style={{ width: 180 }}
          />
        </Row>
        <Row title="显示翻译" desc="后端返回 tlyric 时显示在原文下方">
          <Switch
            ariaLabel="显示歌词翻译"
            checked={settings.lyricShowTranslation}
            onChange={(checked) => void patch({ lyricShowTranslation: checked })}
          />
        </Row>
        <Row title="显示罗马音" desc="后端返回 rlyric 时显示">
          <Switch
            ariaLabel="显示罗马音"
            checked={settings.lyricShowRoman}
            onChange={(checked) => void patch({ lyricShowRoman: checked })}
          />
        </Row>
      </Card>
    </>
  )
}

/* ───────────────────────────── 曲库与扫描 ───────────────────────────── */

/** 「标题来源」的两个选项。文案对齐上游 Flutter 版的语义（标签 vs 文件名） */
const TITLE_SOURCES: SelectOption<ScanTitleSource>[] = [
  { value: 'tag', label: '歌曲元数据', desc: '优先读音频文件里的标题 / 歌手标签' },
  {
    value: 'filename',
    label: '文件名',
    desc: '直接拿文件名（去掉扩展名）当标题，适合文件名已编号的情况'
  }
]

/**
 * 「扫描后自动创建歌单」的下拉。
 *
 * 「关闭」与三档创建方式**放进同一个选框**：它们本来就是同一个决定的不同取值，
 * 拆成「开关 + 子下拉」要额外解释「关掉开关时下面这项不生效」，还多占一行。
 */
type PlaylistChoice = 'off' | PlaylistMode

const PLAYLIST_CHOICES: SelectOption<PlaylistChoice>[] = [
  { value: 'off', label: '关闭', desc: '扫描后不自动生成歌单' },
  { value: 'directory', label: '按文件夹', desc: '每个文件夹生成独立歌单' },
  { value: 'top_level', label: '按顶层文件夹', desc: '子文件夹的歌曲合并到一级文件夹歌单' },
  { value: 'bubble_up', label: '包含子目录', desc: '歌曲同时出现在所有上级文件夹歌单' }
]

/**
 * 「自动扫描间隔」的下拉：开关与间隔是同一个决定（多久扫一次），所以合成一档，
 * 关掉就是选了「关闭」。后端只收秒且限 60 ~ 86400，用固定档位也就省掉一轮越界校验。
 */
type AutoScanChoice = 'off' | number

const AUTO_SCAN_CHOICES: SelectOption<AutoScanChoice>[] = [
  { value: 'off', label: '关闭' },
  { value: 600, label: '每 10 分钟' },
  { value: 1800, label: '每 30 分钟' },
  { value: 3600, label: '每 1 小时' },
  { value: 10800, label: '每 3 小时' },
  { value: 21600, label: '每 6 小时' },
  { value: 43200, label: '每 12 小时' },
  { value: 86400, label: '每 24 小时' }
]

/** 后端默认值：关闭 / 1 小时 */
const DEFAULT_SCAN_INTERVAL = 3600

/**
 * 把后端的「开关 + 秒数」折成下拉里的一档。
 * 档位外的秒数是防「别的客户端写进来的值」—— 直接给下拉会落到空标签上，
 * 看着像设置坏了；折到默认档位至少显示的是一个真值（后端仍按原值跑）。
 */
function toAutoScanChoice(setting: AutoScanSetting | null | undefined): AutoScanChoice {
  if (!setting?.enabled) return 'off'
  return AUTO_SCAN_CHOICES.some((item) => item.value === setting.interval_seconds)
    ? setting.interval_seconds
    : DEFAULT_SCAN_INTERVAL
}

const REFRESH_STATUS_LABEL: Record<MetadataRefreshStatus, string> = {
  idle: '空闲',
  running: '进行中',
  cancelling: '正在取消',
  done: '已完成',
  cancelled: '已取消',
  failed: '执行失败'
}

function LibrarySettings(): React.JSX.Element {
  const musicPath = useAsync(() => getMusicPath(requireClient()), [])
  const autoPlaylists = useAsync(() => getScanAutoCreatePlaylists(requireClient()), [])
  const playlistMode = useAsync(() => getScanPlaylistMode(requireClient()), [])
  const titleSource = useAsync(() => getScanTitleSource(requireClient()), [])
  const autoScan = useAsync(() => getAutoScan(requireClient()), [])
  const autoFingerprint = useAsync(() => getScanAutoFingerprint(requireClient()), [])
  const tagSync = useAsync(() => getTagSyncToFile(requireClient()), [])
  // 与「标题来源」是两个设置：这一项只管「刷新元数据」时要不要用标签标题覆盖网络歌曲
  const remoteTitleSource = useAsync(() => getRemoteTitleSource(requireClient()), [])
  const fingerprints = useAsync(() => getFingerprintStatus(requireClient()), [])
  // useAsync 返回的对象每次渲染都是新的，但 reload 本身是 useCallback 稳定的；
  // 单独取出来给 effect 当依赖，免得把整只对象塞进去让定时器反复重建
  const reloadFingerprints = fingerprints.reload

  const [progress, setProgress] = useState<ScanProgress | null>(null)
  // 排除目录的三个字段是一次覆盖写，所以整份配置只留一处草稿，三个页签共改它
  const [pathDraft, setPathDraft] = useState<MusicPathSetting | null>(null)
  // 排除目录默认收起：它是一坨配置，占位置远多于改动频率
  const [excludeOpen, setExcludeOpen] = useState(false)
  const [refresh, setRefresh] = useState<MetadataRefreshProgress | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicatesResult | null>(null)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  // 指纹任务的运行态；`null` = 还没读到（区别于「读到了但空闲」）
  const [fpProgress, setFpProgress] = useState<FingerprintProgress | null>(null)
  // 失败清单只在点开弹窗时拉：它是「偶尔看一眼」的详情，不该跟着页面常驻请求
  const [fpFailedOpen, setFpFailedOpen] = useState(false)
  const [fpFailed, setFpFailed] = useState<FailedFingerprint[]>([])
  const [fpFailedLoading, setFpFailedLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)
  const refreshPollRef = useRef<number | null>(null)
  const fpPollRef = useRef<number | null>(null)
  // 「检测重复」右侧那个下拉触发器的元素：既给它对位，也让 aria-expanded 说准
  const fpMenuRef = useRef<HTMLButtonElement | null>(null)
  // 只为读菜单宿主的真实状态，不另存一份「我开着」
  const fpMenuOpen = useContextMenu((s) => s.open && s.anchor === fpMenuRef.current)

  // 配置到达后填充草稿（用户已经在编辑就别覆盖）
  useEffect(() => {
    if (!musicPath.data) return
    setPathDraft((prev) => prev ?? musicPath.data!)
  }, [musicPath.data])

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const stopRefreshPolling = useCallback(() => {
    if (refreshPollRef.current !== null) {
      window.clearInterval(refreshPollRef.current)
      refreshPollRef.current = null
    }
  }, [])

  const stopFpPolling = useCallback(() => {
    if (fpPollRef.current !== null) {
      window.clearInterval(fpPollRef.current)
      fpPollRef.current = null
    }
  }, [])

  const isScanning =
    progress != null &&
    ['scanning', 'importing', 'splitting_cue', 'creating_playlists', 'cancelling'].includes(
      progress.status
    )

  const refreshRunning = refresh?.status === 'running' || refresh?.status === 'cancelling'

  // 指纹任务的运行态只有一个值（后端没有单独的 cancelling 态）
  const fpRunning = fpProgress?.status === 'running'

  // 扫描中才轮询；停下就清掉定时器，别让后台一直发请求
  useEffect(() => {
    if (!isScanning) {
      stopPolling()
      return
    }
    if (pollRef.current !== null) return
    pollRef.current = window.setInterval(() => {
      void getScanProgress(requireClient())
        .then(setProgress)
        .catch(() => undefined)
    }, 1200)
    return stopPolling
  }, [isScanning, stopPolling])

  // 刷新元数据同理：后端是全局单例任务，可能上一次还没跑完就又进了这页
  useEffect(() => {
    if (!refreshRunning) {
      stopRefreshPolling()
      return
    }
    if (refreshPollRef.current !== null) return
    refreshPollRef.current = window.setInterval(() => {
      void getMetadataRefreshProgress(requireClient())
        .then(setRefresh)
        .catch(() => undefined)
    }, 2000)
    return stopRefreshPolling
  }, [refreshRunning, stopRefreshPolling])

  // 指纹计算同一套：它比元数据刷新更慢（每首都要起一次 ffmpeg），轮询间隔放长一点
  useEffect(() => {
    if (!fpRunning) {
      stopFpPolling()
      return
    }
    if (fpPollRef.current !== null) return
    fpPollRef.current = window.setInterval(() => {
      void getFingerprintProgress(requireClient())
        .then((next) => {
          setFpProgress(next)
          // 轮询是唯一能知道「跑完了」的地方：看到非 running 就把统计重读一次，
          // 否则「已算 N」会一直停在任务开始前的旧数字
          if (next.status !== 'running') reloadFingerprints()
        })
        .catch(() => undefined)
    }, 1500)
    return stopFpPolling
  }, [fpRunning, stopFpPolling, reloadFingerprints])

  // 进页面先各读一次，避免「明明在扫（或在刷元数据/算指纹）但界面显示空闲」
  useEffect(() => {
    void getScanProgress(requireClient())
      .then(setProgress)
      .catch(() => undefined)
    void getMetadataRefreshProgress(requireClient())
      .then(setRefresh)
      .catch(() => undefined)
    void getFingerprintProgress(requireClient())
      .then(setFpProgress)
      .catch(() => undefined)
  }, [])

  /** 服务端单项设置的通用写回：失败提示 + 回读。开关/下拉本身就是成功反馈，不再弹 toast。 */
  const writeSetting = useCallback((action: Promise<void>, reload: () => void): void => {
    void action
      .then(reload)
      .catch((error: unknown) =>
        toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
      )
  }, [])

  /**
   * 一次性动作的统一跑法：占住 busy、成功提示、失败提示。
   * `after` 只在**成功之后**跑 —— 例如保存排除目录要顺带收起那块折叠区，
   * 保存失败还收起来的话，用户就只能自己再展开一遍才能改回去。
   */
  const run = useCallback(
    async (
      key: string,
      action: () => Promise<void>,
      successMessage: string,
      after?: () => void
    ) => {
      setBusy(key)
      try {
        await action()
        after?.()
        toast(successMessage, 'success')
      } catch (error) {
        toast('操作失败', 'error', error instanceof Error ? error.message : undefined)
      } finally {
        setBusy(null)
      }
    },
    []
  )

  const percent =
    progress && progress.total_files > 0
      ? Math.floor((progress.scanned_files * 100) / progress.total_files)
      : 0

  const refreshPercent =
    refresh && refresh.total > 0 ? Math.floor((refresh.processed * 100) / refresh.total) : 0

  // 分母优先用任务自己的 total：它一开始就是「本次要算几首」，而统计接口的 total 是曲库总数
  const fpTotal = fpProgress?.total || fingerprints.data?.total || 0
  const fpPercent =
    fpProgress && fpTotal > 0 ? Math.floor((fpProgress.computed * 100) / fpTotal) : 0

  /**
   * 触发一次指纹计算（界面只有「重试识别」与「全量重算」两条路）并立刻把进度读回来，
   * 好让轮询这一帧就接上（否则要等下一个 tick 才动）。
   */
  const startFingerprint = (mode: 'retryFailed' | 'recomputeAll'): Promise<void> =>
    run(
      'fingerprint',
      async () => {
        await computeFingerprints(requireClient(), {
          recomputeAll: mode === 'recomputeAll',
          retryFailed: mode === 'retryFailed'
        })
        setFpProgress(await getFingerprintProgress(requireClient()))
      },
      mode === 'recomputeAll' ? '已开始全量重算指纹（后台进行）' : '已开始重试失败的指纹'
    )

  /** 检测重复：后端要逐首比对指纹，慢，所以按钮上给转圈 */
  const checkDuplicates = (): void => {
    setCheckingDuplicates(true)
    void findDuplicates(requireClient())
      .then(setDuplicates)
      .catch((error: unknown) =>
        toast('检测失败', 'error', error instanceof Error ? error.message : undefined)
      )
      .finally(() => setCheckingDuplicates(false))
  }

  /** 失败清单只在点开时拉；先把弹窗开起来，加载态由弹窗自己交代 */
  const openFailedList = (): void => {
    setFpFailedOpen(true)
    setFpFailedLoading(true)
    void getFailedFingerprints(requireClient())
      .then(setFpFailed)
      .catch((error: unknown) => {
        setFpFailedOpen(false)
        toast('读取失败清单失败', 'error', error instanceof Error ? error.message : undefined)
      })
      .finally(() => setFpFailedLoading(false))
  }

  /** 全量重算会清空已有指纹，先说清后果再动手 */
  const recomputeAllFingerprints = (): void => {
    const total = fingerprints.data?.total ?? 0
    if (!window.confirm(`清空并重算全部 ${total} 首的指纹？期间检测结果不可用，耗时可能很长。`))
      return
    void startFingerprint('recomputeAll')
  }

  /**
   * 「检测重复」右侧的下拉：一次性与重算类动作都收进来，行里只留一个主按钮。
   * 面板复用 ContextMenuHost（同 SettingSelect），贴边翻转/点别处关闭/Esc 都不用再写一遍。
   */
  const openFingerprintMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const menu = useContextMenu.getState()
    // 宿主对「点触发器」刻意不关（anchor 放行），所以这里读到开着 = 该收起
    if (menu.open) {
      menu.hide()
      return
    }
    const failed = fingerprints.data?.failed ?? 0
    const ready = Boolean(fingerprints.data?.chromaprint_available)
    const items: MenuItem[] = [
      {
        key: 'retry',
        label: '重试识别',
        icon: <IconRefresh size={15} />,
        disabled: !ready || failed === 0,
        onClick: () => void startFingerprint('retryFailed')
      },
      {
        key: 'failed',
        label: '失败详情',
        icon: <IconAlert size={15} />,
        disabled: failed === 0,
        onClick: openFailedList
      },
      { key: 'divider', label: '', separator: true },
      {
        key: 'recompute',
        label: '全量重算',
        icon: <IconSparkle size={15} />,
        disabled: !ready,
        onClick: recomputeAllFingerprints
      }
    ]
    const rect = event.currentTarget.getBoundingClientRect()
    // 右对齐：触发器长在行的右端，左对齐会让面板往卡片外探出一截
    menu.show(rect.left, rect.bottom + 6, items, {
      anchor: event.currentTarget,
      align: 'right',
      anchorRect: rect
    })
  }

  // 开关也并进这个下拉：关掉就是选了「关闭」这一档
  const playlistChoice: PlaylistChoice = autoPlaylists.data
    ? (playlistMode.data ?? 'directory')
    : 'off'
  // 三档创建方式的差别不在名字上，而在「一首歌到底会进哪几个歌单」，所以说明跟着选中项走
  const playlistDesc =
    PLAYLIST_CHOICES.find((item) => item.value === playlistChoice)?.desc ?? PLAYLIST_CHOICES[0].desc

  /** 排除目录收起时的摘要：不展开也知道自己排了些什么 */
  const excludeSummary = pathDraft
    ? `名称 ${pathDraft.exclude_dirs.length} · 路径 ${pathDraft.exclude_paths.length} · 歌单 ${pathDraft.auto_create_exclude_dirs.length}`
    : ''

  /** 同理：开关也并进「自动扫描间隔」这一档下拉 */
  const autoScanChoice = toAutoScanChoice(autoScan.data)

  /** 选「关闭」时把原间隔留着不丢，下次开启还是原来那一档 */
  const changeAutoScan = (choice: AutoScanChoice): void => {
    writeSetting(
      setAutoScan(requireClient(), {
        enabled: choice !== 'off',
        interval_seconds:
          choice === 'off' ? (autoScan.data?.interval_seconds ?? DEFAULT_SCAN_INTERVAL) : choice
      }),
      () => autoScan.reload()
    )
  }

  /**
   * 一档切换 = 两个后端字段（模式 + 开关）。写的顺序有讲究：必须**先落模式再开开关**，
   * 反过来的话，开关已生效而模式还没落库的那一小段，后端会按旧模式（默认 directory）建歌单。
   */
  const changePlaylistChoice = (choice: PlaylistChoice): void => {
    const reload = (): void => {
      autoPlaylists.reload()
      playlistMode.reload()
    }
    if (choice === 'off') {
      writeSetting(setScanAutoCreatePlaylists(requireClient(), false), reload)
      return
    }
    void setScanPlaylistMode(requireClient(), choice)
      .then(() => setScanAutoCreatePlaylists(requireClient(), true))
      .then(reload)
      .catch((error: unknown) =>
        toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
      )
  }

  return (
    <>
      <Card title="扫描">
        {/*
          顺序照上游 Flutter 版的 `scan_manager.dart`：建歌单 → 歌单方式 → 标题来源 →
          自动扫描（含间隔）→ 自动指纹 → 回写标签 → 排除目录 → 扫描进度。
          排除目录贴着扫描进度是有意的：一个决定「扫什么」，一个是「扫到哪了」。
          音乐根目录的输入框则撤掉了 —— 它属于部署配置，改错一个字符整库就扫不到，
          不该跟日常开关放在一起（原 Flutter 版也没在这放）。
        */}
        <Row
          server
          title="扫描后自动创建歌单"
          desc={autoPlaylists.loading ? '正在读取…' : playlistDesc}
          control={
            <SettingSelect
              ariaLabel="扫描后自动创建歌单"
              value={playlistChoice}
              options={PLAYLIST_CHOICES}
              disabled={autoPlaylists.loading || playlistMode.loading}
              onChange={changePlaylistChoice}
              width={170}
            />
          }
        />

        <Row
          server
          title="标题来源"
          desc="改完要用「强制扫描」再扫一次才生效（那一档会重读已入库文件的元数据）"
          control={
            <SettingSelect
              ariaLabel="标题来源"
              value={titleSource.data ?? 'tag'}
              options={TITLE_SOURCES}
              disabled={titleSource.loading}
              onChange={(next) =>
                writeSetting(setScanTitleSource(requireClient(), next), () => titleSource.reload())
              }
              width={150}
            />
          }
        />

        <Row
          server
          title="自动扫描间隔"
          desc="每隔这么久自动扫一次新文件；选「关闭」就只在手动点「重新扫描」时扫"
          control={
            autoScan.loading ? (
              <IconLoader size={16} />
            ) : (
              <SettingSelect
                ariaLabel="自动扫描间隔"
                value={autoScanChoice}
                options={AUTO_SCAN_CHOICES}
                onChange={changeAutoScan}
                width={128}
              />
            )
          }
        />

        <Row
          server
          title="扫描后自动计算音频指纹"
          desc="指纹只用于重复歌曲检测。大曲库开启后会长时间占用 CPU；关着也能在「曲库维护」里手动算"
        >
          {autoFingerprint.loading ? (
            <IconLoader size={16} />
          ) : (
            <Switch
              ariaLabel="扫描后自动计算音频指纹"
              checked={autoFingerprint.data ?? false}
              onChange={(checked) =>
                writeSetting(setScanAutoFingerprint(requireClient(), checked), () =>
                  autoFingerprint.reload()
                )
              }
            />
          )}
        </Row>

        <Row
          server
          title="编辑元数据时回写音频文件"
          desc="关闭后只改数据库，本地文件的标签保持原样"
        >
          {tagSync.loading ? (
            <IconLoader size={16} />
          ) : (
            <Switch
              ariaLabel="回写音频文件标签"
              checked={tagSync.data ?? false}
              onChange={(checked) =>
                writeSetting(setTagSyncToFile(requireClient(), checked), () => tagSync.reload())
              }
            />
          )}
        </Row>

        <Row
          server
          block
          title="排除目录"
          desc={
            excludeOpen
              ? '扫描时跳过这些目录；三种排除的作用范围不同，切页签看说明'
              : `扫描时跳过这些目录${excludeSummary ? ` · 当前 ${excludeSummary}` : ''}`
          }
          onToggle={() => setExcludeOpen((open) => !open)}
          expanded={excludeOpen}
          control={
            <span className="collapse-hint">
              {excludeOpen ? '收起' : '展开'}
              <IconChevronDown
                size={15}
                className="collapse-caret"
                data-open={excludeOpen ? 'true' : undefined}
              />
            </span>
          }
        >
          {excludeOpen ? (
            <div id="exclude-dirs-editor">
              {pathDraft ? (
                <ExcludeDirsEditor
                  value={pathDraft}
                  onChange={setPathDraft}
                  saving={busy === 'exclude'}
                  // 存完就收起来：这块折叠区是为「改一改」临时打开的，
                  // 保存成功说明这次改动结束了，再摊着只是挡住下面的扫描按钮
                  onSave={() =>
                    void run(
                      'exclude',
                      async () => {
                        await updateMusicPath(requireClient(), pathDraft)
                        musicPath.reload()
                      },
                      '排除目录已保存，后台正在清理被排除目录中的歌曲',
                      () => setExcludeOpen(false)
                    )
                  }
                />
              ) : (
                <div className="field-hint">
                  {musicPath.error ? `读取排除配置失败：${musicPath.error}` : '正在读取排除配置…'}
                </div>
              )}
            </div>
          ) : null}
        </Row>

        <Row
          server
          block
          title="扫描进度"
          desc={
            progress
              ? progress.status === 'idle'
                ? '当前空闲'
                : `${progress.status} · ${progress.scanned_files}/${progress.total_files} · 导入 ${progress.imported_files} / 跳过 ${progress.skipped_files} / 失败 ${progress.failed_files}`
              : '正在读取…'
          }
        >
          {isScanning ? (
            <>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="setting-row-desc" style={{ marginTop: 8 }}>
                {percent}%{progress?.current_file ? ` · ${progress.current_file}` : ''}
                {progress && progress.cue_split_sources > 0
                  ? ` · 已切 CUE 整轨 ${progress.cue_split_sources} 个`
                  : ''}
              </div>
              {/* 扫描中只剩「停下来」这一件事可做：两个入口一起消失，不留能按的假按钮 */}
              <button
                type="button"
                className="btn"
                data-variant="danger"
                style={{ width: '100%', marginTop: 10 }}
                disabled={busy === 'cancel'}
                onClick={() =>
                  void run('cancel', () => cancelScan(requireClient()), '已请求取消扫描')
                }
              >
                取消扫描
              </button>
            </>
          ) : (
            <div className="scan-actions">
              <button
                type="button"
                className="btn"
                data-variant="success"
                style={{ flex: 1 }}
                disabled={busy === 'scan'}
                data-tip="扫描尚未入库的新文件（已在库里的按修改时间跳过）"
                onClick={() =>
                  void run(
                    'scan',
                    async () => {
                      await startScan(requireClient(), false)
                      setProgress(await getScanProgress(requireClient()))
                    },
                    '扫描已开始'
                  )
                }
              >
                <IconRefresh size={15} />
                重新扫描
              </button>
              <button
                type="button"
                className="btn"
                style={{ flex: 'none' }}
                disabled={busy === 'force'}
                data-tip="忽略缓存：已入库的文件也重新读一遍元数据（改了「标题来源」就该跑它），慢"
                onClick={() =>
                  void run(
                    'force',
                    async () => {
                      await startScan(requireClient(), true)
                      setProgress(await getScanProgress(requireClient()))
                    },
                    '强制扫描已开始'
                  )
                }
              >
                <IconSparkle size={15} />
                强制扫描
              </button>
            </div>
          )}
        </Row>
      </Card>

      <Card title="元数据维护">
        <Row
          server
          title="使用标签覆盖标题"
          // 副标题逐字照上游 Flutter 版（metadata_refresh_manager.dart）：这两个开关
          // 方向相反（我们的「标题来源」是「开 = 用文件名」），差别全靠这两句话交代
          desc={
            remoteTitleSource.loading
              ? '正在读取…'
              : remoteTitleSource.data === 'tag'
                ? '网络歌曲元数据刷新时用音频标签覆盖标题'
                : '网络歌曲标题保持文件名，不使用标签覆盖'
          }
          control={
            remoteTitleSource.loading ? (
              <IconLoader size={16} />
            ) : (
              <Switch
                ariaLabel="使用标签覆盖标题"
                checked={remoteTitleSource.data === 'tag'}
                onChange={(checked) =>
                  writeSetting(
                    setRemoteTitleSource(requireClient(), checked ? 'tag' : 'filename'),
                    () => remoteTitleSource.reload()
                  )
                }
              />
            )
          }
        />

        <Row
          server
          block
          title="刷新进度"
          desc={
            refreshRunning
              ? `刷新中 · 已完成 ${refresh?.processed ?? 0}/${refresh?.total ?? 0}${
                  refresh && refresh.failed > 0 ? `，失败 ${refresh.failed}` : ''
                }`
              : refresh && refresh.status !== 'idle'
                ? `上次刷新${REFRESH_STATUS_LABEL[refresh.status]}：成功 ${Math.max(
                    0,
                    refresh.processed - refresh.failed
                  )} 首${refresh.failed > 0 ? `，失败 ${refresh.failed} 首` : ''}`
                : '重新探测元数据缺失的歌曲（本地文件与已缓存的网络歌曲），只补空缺，不改动音频文件里的标签'
          }
        >
          {/* 与上面「扫描进度」同一套：空闲一个大按钮，跑起来就换成
              进度条 + 百分比 + 满宽的取消，不给「再点一次」留位置 */}
          {refreshRunning ? (
            <>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${refreshPercent}%` }} />
              </div>
              <div className="setting-row-desc" style={{ marginTop: 8 }}>
                {refreshPercent}%
              </div>
              <button
                type="button"
                className="btn"
                data-variant="danger"
                style={{ width: '100%', marginTop: 10 }}
                disabled={refresh?.status === 'cancelling'}
                onClick={() =>
                  void run(
                    'refresh-cancel',
                    () => cancelMetadataRefresh(requireClient()),
                    '已请求取消刷新'
                  )
                }
              >
                取消刷新
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              data-variant="success"
              style={{ width: '100%' }}
              disabled={busy === 'refresh'}
              onClick={() =>
                void run(
                  'refresh',
                  async () => {
                    await startMetadataRefresh(requireClient())
                    setRefresh(await getMetadataRefreshProgress(requireClient()))
                  },
                  '已开始刷新元数据（后台进行）'
                )
              }
            >
              <IconRefresh size={15} />
              刷新元数据
            </button>
          )}
        </Row>
      </Card>

      <Card title="曲库维护">
        <Row server title="清理失效歌曲" desc="把数据库里文件已经不存在的记录清掉（不动任何文件）">
          <button
            type="button"
            className="btn"
            disabled={busy === 'clean'}
            onClick={() =>
              void run(
                'clean',
                async () => {
                  const result = await cleanMissingSongs(requireClient())
                  toast(
                    `清理完成：共 ${result.total} 条（文件不存在 ${result.file_not_found}，在排除目录 ${result.in_excluded_dir}）`,
                    'success'
                  )
                },
                '已执行清理'
              )
            }
          >
            开始清理
          </button>
        </Row>

        <Row
          server
          block
          title="重复歌曲检测"
          desc={
            fingerprints.data && !fingerprints.data.chromaprint_available
              ? '后端未安装带 chromaprint 的 ffmpeg，算不出指纹（检测重复要先有指纹）'
              : fingerprints.loading
                ? '正在读取指纹状态…'
                : '同一段音频的不同副本指纹相同，靠它才能认出改过名的重复。指纹没算完时检测结果不完整。'
          }
        >
          {/* 与「扫描进度」同一套：跑起来就换成进度条 + 中断，不给「再点一次」留位置 */}
          {fpRunning ? (
            <>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${fpPercent}%` }} />
              </div>
              <div className="setting-row-desc" style={{ marginTop: 8 }}>
                {fpPercent}% · 已算 {fpProgress?.computed ?? 0}/{fpTotal}
                {fpProgress && fpProgress.failed > 0 ? ` · 失败 ${fpProgress.failed}` : ''}
              </div>
              <button
                type="button"
                className="btn"
                data-variant="danger"
                style={{ width: '100%', marginTop: 10 }}
                disabled={busy === 'cancel-fp'}
                onClick={() =>
                  void run(
                    'cancel-fp',
                    () => cancelFingerprintCompute(requireClient()),
                    '已请求中断指纹计算'
                  )
                }
              >
                中断计算
              </button>
            </>
          ) : (
            <>
              <div className="stat-list">
                {fingerprints.data ? (
                  <>
                    <div className="stat-row">
                      <span>本地歌曲</span>
                      <span className="stat-row-value">{fingerprints.data.total}</span>
                    </div>
                    <div className="stat-row">
                      <span>已算指纹</span>
                      <span className="stat-row-value">{fingerprints.data.computed}</span>
                    </div>
                    <div className="stat-row">
                      <span>待计算</span>
                      <span className="stat-row-value">{fingerprints.data.missing}</span>
                    </div>
                    <div className="stat-row">
                      <span>失败</span>
                      <span
                        className="stat-row-value"
                        style={
                          fingerprints.data.failed > 0 ? { color: 'var(--danger)' } : undefined
                        }
                      >
                        {fingerprints.data.failed}
                      </span>
                    </div>
                  </>
                ) : fingerprints.error ? (
                  <div className="field-hint">读取指纹状态失败：{fingerprints.error}</div>
                ) : (
                  <div className="field-hint">正在读取指纹状态…</div>
                )}
              </div>

              {/* 一个动作 + 它的更多用法：重试/详情/重算都收进主按钮右侧的下拉，
                  行里只留「检测重复」这一个入口 */}
              <div className="scan-actions" style={{ marginTop: 12 }}>
                <div className="split-btn">
                  <button
                    type="button"
                    className="btn"
                    data-variant="primary"
                    disabled={checkingDuplicates}
                    data-tip="按音频指纹找出内容相同的副本"
                    onClick={checkDuplicates}
                  >
                    {checkingDuplicates ? <IconLoader size={15} /> : <IconFingerprint size={15} />}
                    检测重复
                  </button>
                  <button
                    ref={fpMenuRef}
                    type="button"
                    className="btn"
                    data-variant="primary"
                    aria-label="指纹与检测的更多操作"
                    aria-haspopup="menu"
                    aria-expanded={fpMenuOpen}
                    onClick={openFingerprintMenu}
                  >
                    <IconChevronDown size={15} />
                  </button>
                </div>
              </div>
            </>
          )}
        </Row>
      </Card>

      {duplicates ? (
        <DuplicatesModal result={duplicates} onClose={() => setDuplicates(null)} />
      ) : null}

      {fpFailedOpen ? (
        <FailedFingerprintsModal
          items={fpFailed}
          loading={fpFailedLoading}
          onRetry={() => {
            setFpFailedOpen(false)
            void startFingerprint('retryFailed')
          }}
          onClose={() => setFpFailedOpen(false)}
        />
      ) : null}
    </>
  )
}

function DuplicatesModal({
  result,
  onClose
}: {
  result: DuplicatesResult
  onClose: () => void
}): React.JSX.Element {
  const [busyId, setBusyId] = useState<number | null>(null)
  const [removed, setRemoved] = useState<number[]>([])

  return (
    <Modal
      title={`重复歌曲：${result.total_groups} 组 / ${result.total_duplicates} 首`}
      size="wide"
      onClose={onClose}
      footer={
        <button type="button" className="btn" data-variant="primary" onClick={onClose}>
          关闭
        </button>
      }
    >
      {result.groups.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={26} />}
          title="没有发现重复"
          description="要么曲库本来就干净，要么指纹还没算完（指纹没算完时这个结果不可靠）"
        />
      ) : (
        <>
          <div className="probe-result">
            <IconAlert size={15} />
            <span>
              同一指纹说明是同一段音频的不同副本。删除只移除曲库记录，不会删本地文件；
              留哪一份请自己决定（一般留码率更高的）。
            </span>
          </div>
          <div style={{ maxHeight: '46vh', overflowY: 'auto' }}>
            {result.groups.map((group, groupIndex) => (
              <div key={group.fingerprint || groupIndex} style={{ marginBottom: 16 }}>
                <div className="setting-row-title" style={{ marginBottom: 6 }}>
                  第 {groupIndex + 1} 组 · {group.songs.length} 个副本
                </div>
                {group.songs.map((song) => (
                  <div
                    key={song.id}
                    className="row-between"
                    style={{
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--line-1)',
                      opacity: removed.includes(song.id) ? 0.4 : 1
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 13 }}>
                        {song.title}
                        {song.artist ? (
                          <span style={{ color: 'var(--text-3)' }}> — {song.artist}</span>
                        ) : null}
                      </div>
                      <div className="truncate" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                        {song.format?.toUpperCase() || '?'} · {Math.round(song.bit_rate / 1000)}kbps
                        · {formatBytes(song.file_size)} · {song.file_path}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn"
                      data-size="sm"
                      data-variant="danger"
                      disabled={busyId === song.id || removed.includes(song.id)}
                      onClick={() => {
                        if (
                          !window.confirm(`从曲库删除记录「${song.title}」？（不会删除本地文件）`)
                        )
                          return
                        setBusyId(song.id)
                        void deleteSong(requireClient(), song.id, false)
                          .then(() => {
                            setRemoved((prev) => [...prev, song.id])
                            toast('已从曲库删除该记录', 'success')
                          })
                          .catch((error: unknown) =>
                            toast(
                              '删除失败',
                              'error',
                              error instanceof Error ? error.message : undefined
                            )
                          )
                          .finally(() => setBusyId(null))
                      }}
                    >
                      <IconTrash size={14} />
                      删这条
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

/** 后端给的是 unix 秒（0 = 没试过），转成 formatRelative 认的 ISO 串 */
function unixSecondsToIso(seconds: number): string {
  return seconds > 0 ? new Date(seconds * 1000).toISOString() : ''
}

function FailedFingerprintsModal({
  items,
  loading,
  onRetry,
  onClose
}: {
  items: FailedFingerprint[]
  loading: boolean
  onRetry: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={loading ? '指纹计算失败' : `指纹计算失败：${items.length} 首`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            关闭
          </button>
          <button
            type="button"
            className="btn"
            data-variant="primary"
            disabled={loading || items.length === 0}
            onClick={onRetry}
          >
            <IconRefresh size={15} />
            重试这些歌曲
          </button>
        </>
      }
    >
      {loading ? (
        <div className="field-hint">正在读取失败清单…</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={26} />}
          title="没有失败的歌曲"
          description="当前所有本地歌曲都算出了指纹"
        />
      ) : (
        <>
          <div className="probe-result">
            <IconAlert size={15} />
            <span>
              这些歌曲反复算不出指纹，后端已记下「试过了」—— 不会每轮扫描再把它们捞出来白跑
              ffmpeg。常见原因：文件损坏、没有音轨、格式不受支持。文件修好后点「重试这些歌曲」。
            </span>
          </div>
          <div className="fail-list">
            {items.map((item) => (
              <div key={item.id} className="fail-item">
                <div className="truncate" style={{ fontSize: 13 }}>
                  {item.title}
                  {item.artist ? (
                    <span style={{ color: 'var(--text-3)' }}> — {item.artist}</span>
                  ) : null}
                </div>
                <div className="truncate" style={{ fontSize: 11.5, color: 'var(--text-4)' }}>
                  {item.file_path}
                  {item.attempted_at > 0
                    ? ` · ${formatRelative(unixSecondsToIso(item.attempted_at))}`
                    : ''}
                </div>
                <div className="fail-item-reason">{item.error || '未知原因'}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  )
}

/* ───────────────────────────── 服务器 ───────────────────────────── */

function ServerSettings(): React.JSX.Element {
  const tokens = useAsync(() => getTokens(requireClient(), 50, 0), [])

  // 只列 refresh token：access token 短命、一台设备会刷出很多个，列出来只是噪音；
  // refresh token 才对应「一条登录设备记录」，吊销它才会让那台设备下线。
  const devices: TokenInfo[] = (tokens.data?.tokens ?? []).filter(
    (token) => token.token_type === 'refresh'
  )

  return (
    <>
      <Card
        title="登录设备"
        action={
          <>
            <span className="badge">{devices.length}</span>
            <button type="button" className="btn" data-size="sm" onClick={() => tokens.reload()}>
              <IconRefresh size={14} />
              刷新
            </button>
          </>
        }
      >
        {tokens.loading ? (
          <Row title="正在读取设备…">
            <IconLoader size={16} />
          </Row>
        ) : tokens.error ? (
          <Row title="读取失败" desc={tokens.error}>
            <span />
          </Row>
        ) : devices.length === 0 ? (
          <Row title="没有可管理的设备">
            <span />
          </Row>
        ) : (
          devices.map((token) => (
            <Row
              key={token.token_id}
              title={token.client_info ?? '未知设备'}
              desc={`签发 ${formatDate(token.created_at)} · 过期 ${formatDate(token.expires_at)}${
                token.revoked_at ? ' · 已吊销' : ''
              }`}
            >
              <button
                type="button"
                className="btn"
                data-size="sm"
                data-variant="danger"
                disabled={Boolean(token.revoked_at)}
                onClick={() => {
                  if (!window.confirm('吊销该令牌？使用它的设备会立刻退出登录。')) return
                  void revokeToken(requireClient(), token.token_id)
                    .then(() => {
                      toast('已吊销', 'success')
                      tokens.reload()
                    })
                    .catch((error: unknown) =>
                      toast('吊销失败', 'error', error instanceof Error ? error.message : undefined)
                    )
                }}
              >
                <IconEyeOff size={14} />
                吊销
              </button>
            </Row>
          ))
        )}
      </Card>
    </>
  )
}

/* ───────────────────────────── 账号 ───────────────────────────── */

function AccountSettings(): React.JSX.Element {
  const { baseUrl, serverName, username, status, logout, openLogin } = useAuth()
  const [probe, setProbe] = useState<ServerProbeResult | null>(null)
  const [probing, setProbing] = useState(false)

  const runProbe = useCallback(async (): Promise<void> => {
    if (!baseUrl) return
    setProbing(true)
    try {
      setProbe(await window.songloft.servers.probe(baseUrl))
    } catch (error) {
      setProbe({
        ok: false,
        version: null,
        healthy: false,
        error: error instanceof Error ? error.message : '探测失败',
        elapsedMs: 0
      })
    } finally {
      setProbing(false)
    }
  }, [baseUrl])

  // 进页面自动探一次：版本号与连接耗时就是「已连接」这个状态的展示内容，
  // 不该等用户先点一下「测试连接」才肯出现。
  useEffect(() => {
    void runProbe()
  }, [runProbe])

  // probe 结果是「此刻能不能连上」的可信来源；还没探完时退回登录态判断，
  // 免得刚进页面就闪一下「断开链接」。
  const connected = probe ? probe.ok : status === 'authenticated'
  const meta = [
    probe?.version ? `v${probe.version}` : null,
    probe?.elapsedMs ? `${probe.elapsedMs}ms` : null
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <Card title="账号管理">
        <Row
          title={
            <>
              {serverName ?? baseUrl ?? '未配置服务器'}
              {connected ? (
                meta ? (
                  <span className="setting-row-meta">{meta}</span>
                ) : null
              ) : (
                <span className="setting-row-meta" data-tone="danger">
                  断开链接
                </span>
              )}
            </>
          }
          desc={
            baseUrl
              ? `服务器地址 ${baseUrl}${!connected && probe?.error ? ` · ${probe.error}` : ''}`
              : '尚未连接任何服务器'
          }
        >
          <button
            type="button"
            className="btn"
            disabled={!baseUrl || probing}
            onClick={() => void runProbe()}
          >
            {probing ? <IconLoader size={15} /> : <IconServer size={15} />}
            测试连接
          </button>
        </Row>

        <Row title={username ?? '未知账号'} desc="当前登录账号，凭据保存在本机">
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn" data-size="sm" onClick={openLogin}>
              切换账号
            </button>
            <button
              type="button"
              className="btn"
              data-size="sm"
              data-variant="danger"
              onClick={() => {
                if (window.confirm('退出登录？')) void logout()
              }}
            >
              <IconLogout size={15} />
              退出登录
            </button>
          </div>
        </Row>
      </Card>
    </>
  )
}

/* ───────────────────────────── 关于 ───────────────────────────── */

/** 「关于」里要打开的两个地址：本仓库在前，上游原项目在后 */
const ABOUT_LINKS: { href: string; label: string }[] = [
  { href: REPO_URL, label: '本仓库' },
  { href: UPSTREAM_URL, label: '原项目' }
]

function AboutSettings(): React.JSX.Element {
  const { backendVersion } = useAuth()
  const info = useAsync<AppInfo>(() => window.songloft.app.info(), [])

  const rows: [string, string][] = info.data
    ? [
        ['应用版本', info.data.version],
        ['Electron', info.data.electron],
        ['Chromium', info.data.chrome],
        ['Node', info.data.node],
        ['平台', info.data.platform],
        [
          '运行方式',
          info.data.packaged ? (info.data.appImage ? 'AppImage' : '已安装包') : '开发模式'
        ],
        ['后端版本', backendVersion ?? '未知']
      ]
    : []

  return (
    <>
      <Card title="Songloft Desktop">
        <Row
          title="这是什么"
          desc="songloft-player 的 Electron 桌面重写版：只做桌面端，用一套 Web 技术栈换取更小的体积与更顺的宽屏布局。数据与后端协议完全沿用原项目。"
        >
          <div className="row" style={{ gap: 8 }}>
            {ABOUT_LINKS.map(({ href, label }) => (
              <button
                key={href}
                type="button"
                className="btn"
                data-size="sm"
                onClick={() => void window.songloft.shell.openExternal(href)}
              >
                <IconExternal size={14} />
                {label}
              </button>
            ))}
          </div>
        </Row>

        {info.loading ? (
          <Row title="正在读取运行信息…">
            <IconLoader size={16} />
          </Row>
        ) : (
          rows.map(([label, value]) => (
            <Row key={label} title={label} desc={<span className="mono selectable">{value}</span>}>
              <span />
            </Row>
          ))
        )}
      </Card>

      <Card title="快捷键">
        <Row title="Ctrl / Cmd + K" desc="打开命令面板：搜索歌曲、跳转页面、控制播放">
          <span className="badge">全局</span>
        </Row>
        <Row title="空格" desc="播放 / 暂停（输入框内不生效）">
          <span className="badge">播放</span>
        </Row>
        <Row title="Ctrl / Cmd + ← →" desc="上一首 / 下一首">
          <span className="badge">播放</span>
        </Row>
        <Row title="↑ / ↓" desc="音量增减 5%">
          <span className="badge">播放</span>
        </Row>
        <Row title="Ctrl / Cmd + F" desc="聚焦到搜索框">
          <span className="badge">导航</span>
        </Row>
        <Row title="Alt + ←" desc="返回上一页">
          <span className="badge">导航</span>
        </Row>
        <Row
          title="媒体键 / 托盘"
          desc="键盘上的播放暂停、上一首、下一首键直接接管；最小化到托盘后仍可控制"
        >
          <IconSliders size={15} />
        </Row>
      </Card>
    </>
  )
}
