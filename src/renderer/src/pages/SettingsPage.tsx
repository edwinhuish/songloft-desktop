/**
 * 设置。
 *
 * 分成「本地偏好」与「服务端设置」两类，并在界面上明确分区 —— 这一区分很重要：
 * 主题/歌词字号是本机的，改了不影响别的设备；音乐目录/扫描策略是服务端的，改了对所有客户端生效。
 * 原 Flutter 端把两类混在同一个长列表里，用户改完不知道到底改了谁。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AppInfo, ServerProbeResult } from '@shared/ipc'
import { REPO_URL, UPSTREAM_URL } from '@shared/links'
import type { DuplicatesResult, MusicPathSetting, ScanProgress, TokenInfo } from '@shared/types'
import {
  IconAlert,
  IconCheck,
  IconEyeOff,
  IconExternal,
  IconLoader,
  IconLogout,
  IconMonitor,
  IconMoon,
  IconRefresh,
  IconSearch,
  IconServer,
  IconSliders,
  IconSparkle,
  IconSun,
  IconTrash
} from '@/components/Icons'
import { Modal } from '@/components/Modal'
import { EmptyState, Switch } from '@/components/primitives'
import {
  cancelScan,
  cleanMissingSongs,
  computeFingerprints,
  deleteSong,
  findDuplicates,
  getFingerprintStatus,
  getHlsProxyEnabled,
  getMusicPath,
  getScanProgress,
  getScanAutoCreatePlaylists,
  getScanTitleSource,
  getTagSyncToFile,
  getTokens,
  getVolumeNormalize,
  revokeToken,
  setHlsProxyEnabled,
  setScanAutoCreatePlaylists,
  setScanTitleSource,
  setTagSyncToFile,
  setVolumeNormalize,
  startScan,
  updateMusicPath
} from '@/api/endpoints'
import { useAsync } from '@/hooks/useAsync'
import { formatBytes, formatDate } from '@/lib/format'
import { requireClient, useAuth } from '@/state/useAuth'
import { currentAccentHex, useSettings } from '@/state/useSettings'
import { useUi, type SettingsSection } from '@/state/useUi'
import { toast } from '@/state/useToasts'

const SECTIONS: { key: SettingsSection; label: string }[] = [
  { key: 'appearance', label: '外观' },
  { key: 'playback', label: '播放与歌词' },
  { key: 'library', label: '曲库与扫描' },
  { key: 'server', label: '服务器' },
  { key: 'account', label: '账号与设备' },
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
  title: string
  desc?: React.ReactNode
  /** 该项是服务端设置（对所有设备生效） */
  server?: boolean
  children: React.ReactNode
}

function Row({ title, desc, server, children }: RowProps): React.JSX.Element {
  return (
    <div className="setting-row">
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
      <div className="setting-row-control">{children}</div>
    </div>
  )
}

function Card({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="setting-card">
      <div className="setting-card-title">{title}</div>
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
                title={preset}
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
          title="响度归一化（EBU R128）"
          desc="服务端统一各首歌的响度，杂食歌单不用一直调音量"
        >
          {normalize.loading ? (
            <IconLoader size={16} />
          ) : (
            <Switch
              ariaLabel="响度归一化"
              checked={normalize.data?.enabled ?? false}
              onChange={(checked) => {
                void setVolumeNormalize(requireClient(), {
                  enabled: checked,
                  loudness: normalize.data?.loudness ?? -16
                })
                  .then(() => normalize.reload())
                  .then(() => toast(checked ? '已开启响度归一化' : '已关闭响度归一化', 'success'))
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

        <Row
          title="本机音频归一化参数"
          desc="把 normalize=1 一并交给后端音频端点（与上面那个开关是两件事）"
        >
          <Switch
            ariaLabel="本机音频归一化参数"
            checked={settings.volumeNormalize}
            onChange={(checked) => void patch({ volumeNormalize: checked })}
          />
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

function LibrarySettings(): React.JSX.Element {
  const musicPath = useAsync(() => getMusicPath(requireClient()), [])
  const autoPlaylists = useAsync(() => getScanAutoCreatePlaylists(requireClient()), [])
  const titleSource = useAsync(() => getScanTitleSource(requireClient()), [])
  const tagSync = useAsync(() => getTagSyncToFile(requireClient()), [])
  const fingerprints = useAsync(() => getFingerprintStatus(requireClient()), [])

  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [pathDraft, setPathDraft] = useState('')
  const [excludeDraft, setExcludeDraft] = useState('')
  const [duplicates, setDuplicates] = useState<DuplicatesResult | null>(null)
  const [checkingDuplicates, setCheckingDuplicates] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  // 目录设置到达后填充草稿（用户已经在编辑就别覆盖）
  useEffect(() => {
    if (!musicPath.data) return
    setPathDraft((prev) => (prev ? prev : musicPath.data!.path))
    setExcludeDraft((prev) => (prev ? prev : musicPath.data!.exclude_dirs.join(', ')))
  }, [musicPath.data])

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const isScanning =
    progress != null &&
    ['scanning', 'importing', 'splitting_cue', 'creating_playlists', 'cancelling'].includes(
      progress.status
    )

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

  // 进页面先读一次进度，避免「明明在扫但界面显示空闲」
  useEffect(() => {
    void getScanProgress(requireClient())
      .then(setProgress)
      .catch(() => undefined)
  }, [])

  const run = useCallback(
    async (key: string, action: () => Promise<void>, successMessage: string) => {
      setBusy(key)
      try {
        await action()
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

  return (
    <>
      <Card title="音乐目录（服务端）">
        <Row server title="音乐根目录" desc="相对后端容器内的路径，例如 music / media/music">
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ width: 240 }}
              value={pathDraft}
              placeholder="music"
              onChange={(event) => setPathDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy === 'path' || !pathDraft.trim()}
              onClick={() =>
                void run(
                  'path',
                  async () => {
                    const current: MusicPathSetting = musicPath.data ?? {
                      path: 'music',
                      exclude_dirs: [],
                      exclude_paths: [],
                      auto_create_exclude_dirs: []
                    }
                    await updateMusicPath(requireClient(), { ...current, path: pathDraft.trim() })
                    musicPath.reload()
                  },
                  '已保存音乐根目录'
                )
              }
            >
              保存
            </button>
          </div>
        </Row>

        <Row
          server
          title="排除目录"
          desc="逗号分隔的目录名，扫描时跳过（例如 Covers, @eaDir, .git）"
        >
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              style={{ width: 300 }}
              value={excludeDraft}
              placeholder="Covers, @eaDir"
              onChange={(event) => setExcludeDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={busy === 'exclude'}
              onClick={() =>
                void run(
                  'exclude',
                  async () => {
                    const current: MusicPathSetting = musicPath.data ?? {
                      path: 'music',
                      exclude_dirs: [],
                      exclude_paths: [],
                      auto_create_exclude_dirs: []
                    }
                    const exclude = excludeDraft
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                    await updateMusicPath(requireClient(), { ...current, exclude_dirs: exclude })
                    musicPath.reload()
                  },
                  '已保存排除目录'
                )
              }
            >
              保存
            </button>
          </div>
        </Row>
      </Card>

      <Card title="扫描">
        <Row
          server
          title="扫描进度"
          desc={
            progress
              ? progress.status === 'idle'
                ? '当前空闲'
                : `${progress.status} · ${progress.scanned_files}/${progress.total_files} · 导入 ${progress.imported_files} / 跳过 ${progress.skipped_files} / 失败 ${progress.failed_files}`
              : '正在读取…'
          }
        >
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              data-variant="primary"
              disabled={isScanning || busy === 'scan'}
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
              <IconSparkle size={15} />
              开始扫描
            </button>
            <button
              type="button"
              className="btn"
              disabled={isScanning || busy === 'rescan'}
              title="重新读取已入库文件（忽略缓存），文件没变时用不上"
              onClick={() =>
                void run(
                  'rescan',
                  async () => {
                    await startScan(requireClient(), true)
                    setProgress(await getScanProgress(requireClient()))
                  },
                  '重新导入已开始'
                )
              }
            >
              重新导入
            </button>
            <button
              type="button"
              className="btn"
              data-variant="danger"
              disabled={!isScanning}
              onClick={() =>
                void run('cancel', () => cancelScan(requireClient()), '已请求取消扫描')
              }
            >
              取消
            </button>
          </div>
        </Row>

        {progress && progress.status !== 'idle' ? (
          <div className="setting-row" style={{ display: 'block' }}>
            <div className="progress-track" style={{ marginTop: 4 }}>
              <div className="progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="setting-row-desc" style={{ marginTop: 8 }}>
              {percent}%{progress.current_file ? ` · ${progress.current_file}` : ''}
              {progress.cue_split_sources > 0
                ? ` · 已切 CUE 整轨 ${progress.cue_split_sources} 个`
                : ''}
            </div>
          </div>
        ) : null}

        <Row server title="扫描后自动创建歌单" desc="按目录结构生成歌单（每个子目录一个）">
          {autoPlaylists.loading ? (
            <IconLoader size={16} />
          ) : (
            <Switch
              ariaLabel="扫描后自动创建歌单"
              checked={autoPlaylists.data ?? false}
              onChange={(checked) => {
                void setScanAutoCreatePlaylists(requireClient(), checked)
                  .then(() => autoPlaylists.reload())
                  .catch((error: unknown) =>
                    toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
                  )
              }}
            />
          )}
        </Row>

        <Row
          server
          title="标题来源"
          desc="「文件标签」优先读内嵌元数据；「文件名」直接拿文件名当标题"
        >
          <select
            className="input"
            style={{ width: 150 }}
            value={titleSource.data ?? 'tag'}
            disabled={titleSource.loading}
            onChange={(event) => {
              const next = event.target.value === 'filename' ? 'filename' : 'tag'
              void setScanTitleSource(requireClient(), next)
                .then(() => titleSource.reload())
                .catch((error: unknown) =>
                  toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
                )
            }}
          >
            <option value="tag">文件标签</option>
            <option value="filename">文件名</option>
          </select>
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
              onChange={(checked) => {
                void setTagSyncToFile(requireClient(), checked)
                  .then(() => tagSync.reload())
                  .catch((error: unknown) =>
                    toast('设置失败', 'error', error instanceof Error ? error.message : undefined)
                  )
              }}
            />
          )}
        </Row>
      </Card>

      <Card title="曲库维护">
        <Row title="清理失效歌曲" desc="把数据库里文件已经不存在的记录清掉（不动任何文件）">
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
          title="重复歌曲检测"
          desc={
            fingerprints.data
              ? `音频指纹：已算 ${fingerprints.data.computed}/${fingerprints.data.total}${
                  fingerprints.data.failed > 0 ? `，失败 ${fingerprints.data.failed}` : ''
                }${fingerprints.data.chromaprint_available ? '' : '（后端未装 chromaprint，无法算指纹）'}`
              : '正在读取指纹状态…'
          }
        >
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={busy === 'fingerprint' || !fingerprints.data?.chromaprint_available}
              onClick={() =>
                void run(
                  'fingerprint',
                  async () => {
                    await computeFingerprints(requireClient(), false)
                    fingerprints.reload()
                  },
                  '已开始计算指纹（后台进行）'
                )
              }
            >
              计算指纹
            </button>
            <button
              type="button"
              className="btn"
              disabled={checkingDuplicates}
              onClick={() => {
                setCheckingDuplicates(true)
                void findDuplicates(requireClient())
                  .then(setDuplicates)
                  .catch((error: unknown) =>
                    toast('检测失败', 'error', error instanceof Error ? error.message : undefined)
                  )
                  .finally(() => setCheckingDuplicates(false))
              }}
            >
              {checkingDuplicates ? <IconLoader size={15} /> : <IconSearch size={15} />}
              检测重复
            </button>
          </div>
        </Row>
      </Card>

      {duplicates ? (
        <DuplicatesModal result={duplicates} onClose={() => setDuplicates(null)} />
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

/* ───────────────────────────── 服务器 ───────────────────────────── */

function ServerSettings(): React.JSX.Element {
  const { settings, patch } = useSettings()
  const { servers, baseUrl, switchServer, forgetServer, refreshServers } = useAuth()
  const [probe, setProbe] = useState<ServerProbeResult | null>(null)
  const [probing, setProbing] = useState(false)

  const active = useMemo(() => servers.find((s) => s.url === baseUrl), [servers, baseUrl])

  return (
    <>
      <Card title="当前连接">
        <Row title="服务器" desc={baseUrl ?? '未连接'}>
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={!baseUrl || probing}
              onClick={() => {
                if (!baseUrl) return
                setProbing(true)
                setProbe(null)
                void window.songloft.servers
                  .probe(baseUrl)
                  .then(setProbe)
                  .finally(() => setProbing(false))
              }}
            >
              {probing ? <IconLoader size={15} /> : <IconServer size={15} />}
              测试连接
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void refreshServers()
                toast('已刷新服务器列表', 'success')
              }}
            >
              <IconRefresh size={15} />
              刷新
            </button>
          </div>
        </Row>

        {probe ? (
          <Row title="测试结果" desc={probe.error ?? `耗时 ${probe.elapsedMs}ms`}>
            <span className="badge" data-tone={probe.ok ? 'success' : 'danger'}>
              {probe.ok ? `正常${probe.version ? ` · ${probe.version}` : ''}` : '失败'}
            </span>
          </Row>
        ) : null}

        <Row
          title="允许自签 / 无效 TLS 证书"
          desc="打开后本应用的网络栈不再校验证书 —— 只在内网自建、明确知道风险时开启"
        >
          <Switch
            ariaLabel="忽略证书校验"
            checked={settings.allowInsecureTls}
            onChange={(checked) => void patch({ allowInsecureTls: checked })}
          />
        </Row>
      </Card>

      <Card title="已保存的服务器">
        {servers.length === 0 ? (
          <Row title="还没有保存任何服务器">
            <span />
          </Row>
        ) : (
          servers.map((server) => {
            const isActive = server.url === baseUrl
            return (
              <Row
                key={server.url}
                title={server.name}
                desc={`${server.url}${isActive ? ' · 当前使用中' : ''}`}
              >
                <div className="row" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    data-size="sm"
                    disabled={isActive}
                    onClick={() => void switchServer(server.url)}
                  >
                    切换
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="移除该服务器及其本机凭据"
                    aria-label={`移除 ${server.name}`}
                    onClick={() => {
                      if (window.confirm(`移除「${server.name}」及其本机凭据？`))
                        void forgetServer(server.url)
                    }}
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              </Row>
            )
          })
        )}
        {active ? null : (
          <Row title="当前地址不在已保存列表里" desc="登录过一次之后就会出现在这里">
            <span />
          </Row>
        )}
      </Card>
    </>
  )
}

/* ───────────────────────────── 账号与设备 ───────────────────────────── */

function AccountSettings(): React.JSX.Element {
  const { baseUrl, serverName, logout, status } = useAuth()
  const tokens = useAsync(() => getTokens(requireClient(), 50, 0), [])

  const all: TokenInfo[] = tokens.data?.tokens ?? []

  return (
    <>
      <Card title="当前账号">
        <Row title="服务器" desc={`${serverName ?? '未知'} · ${baseUrl ?? '—'}`}>
          <span className="badge" data-tone={status === 'authenticated' ? 'success' : 'default'}>
            {status === 'authenticated' ? '已登录' : status}
          </span>
        </Row>
        <Row title="退出登录" desc="清除本机保存的访问令牌；服务端会吊销当前令牌">
          <button
            type="button"
            className="btn"
            data-variant="danger"
            onClick={() => {
              if (window.confirm('退出登录？')) void logout()
            }}
          >
            <IconLogout size={15} />
            退出登录
          </button>
        </Row>
      </Card>

      <Card title="登录设备 / 令牌">
        <Row title="令牌总数" desc="可以在别的设备上从这里吊销不再使用的登录">
          <div className="row" style={{ gap: 8 }}>
            <span className="badge">{all.length}</span>
            <button type="button" className="btn" data-size="sm" onClick={() => tokens.reload()}>
              <IconRefresh size={14} />
              刷新
            </button>
          </div>
        </Row>

        {tokens.loading ? (
          <Row title="正在读取令牌…">
            <IconLoader size={16} />
          </Row>
        ) : tokens.error ? (
          <Row title="读取失败" desc={tokens.error}>
            <span />
          </Row>
        ) : all.length === 0 ? (
          <Row title="没有可管理的令牌">
            <span />
          </Row>
        ) : (
          all.map((token) => (
            <Row
              key={token.token_id}
              title={`${token.client_info ?? '未知设备'} · ${token.token_type}`}
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

      <Card title="本机凭据">
        <Row
          title="凭据存储位置"
          desc="访问令牌与刷新令牌保存在主进程的 config.json（用户数据目录），不写入渲染层的任何存储"
        >
          <span className="badge">仅本机</span>
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
