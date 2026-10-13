/**
 * 插件管理 —— 扩展主框架右侧的一栏（框架与左栏见 components/ExtensionFrame.tsx）。
 *
 * 只列**已经装上的**：「还能装的」在同框架的插件商店那一栏里。装是「逛」、这是「改配置」，
 * 两种节奏各有各的一栏，而不是并排挤在同一屏里互相争宽度。
 *
 * 列表顺序就是扩展侧栏里那份顺序 —— 同一个 `order`，同一个 applyPluginOrder。
 * 两处各存一份的话，「拖完没反应」或「侧栏顺序自己变了」会随机出现。
 */

import { useState } from 'react'

import { entryPathsOf, pluginDisplayName, type JSPlugin } from '@shared/plugin'
import {
  IconGrip,
  IconLoader,
  IconPuzzle,
  IconRefresh,
  IconSliders,
  IconTrash
} from '@/components/Icons'
import { PluginIcon } from '@/components/PluginIcon'
import { EmptyState, Switch } from '@/components/primitives'
import { useOrderedPlugins, usePlugins } from '@/state/usePlugins'
import { toast } from '@/state/useToasts'

export function ExtensionsPage(): React.JSX.Element {
  const ordered = useOrderedPlugins()
  const loaded = usePlugins((state) => state.loaded)
  const error = usePlugins((state) => state.error)
  const setOrder = usePlugins((state) => state.setOrder)
  const setEnabled = usePlugins((state) => state.setEnabled)
  const remove = usePlugins((state) => state.remove)
  const load = usePlugins((state) => state.load)

  /** 拖拽中的下标与悬停到的下标。都放本地：它们是纯粹的交互瞬时状态，不该进 store */
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const enabledCount = ordered.filter((plugin) => plugin.status === 'active').length

  /**
   * 落位后写回顺序。
   *
   * 写的是**全部已装**的序列（连停用的一起），不是只看启用的那些：只写启用的会把
   * 停用插件的位置从 order 里抹掉，用户重新启用它时它就跳到末尾了 —— 而他什么都没做。
   */
  const dropAt = (index: number): void => {
    const from = dragIndex
    setDragIndex(null)
    setOverIndex(null)
    if (from === null || from === index) return

    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(index, 0, moved)
    void setOrder(entryPathsOf(next)).catch(() => toast('扩展顺序没能保存', 'error'))
  }

  const toggle = (plugin: JSPlugin, next: boolean): void => {
    void setEnabled(plugin.id, next)
      .then(() =>
        toast(next ? `已启用「${pluginDisplayName(plugin)}」` : '已停用该扩展', 'success')
      )
      .catch((reason: unknown) =>
        toast('操作失败', 'error', reason instanceof Error ? reason.message : undefined)
      )
  }

  /**
   * 卸载。
   *
   * 用 window.confirm 而不是自绘弹窗：仓库里所有破坏性确认都是这个路子（见
   * PlaylistsPage / SettingsPage）。它说的是**会发生什么**而不是「确定吗」——
   * 卸载会连插件的磁盘数据一起清掉，这一点必须讲明白。
   */
  const uninstall = (plugin: JSPlugin): void => {
    const name = pluginDisplayName(plugin)
    if (!window.confirm(`卸载「${name}」？插件在本机留下的数据会一并删除，不可恢复。`)) return
    void remove(plugin.id)
      .then(() => toast(`已卸载「${name}」`, 'success'))
      .catch((reason: unknown) =>
        toast('卸载失败', 'error', reason instanceof Error ? reason.message : undefined)
      )
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title row" style={{ gap: 10 }}>
            <IconSliders size={24} />
            插件管理
          </h1>
          <p className="page-subtitle">
            {loaded
              ? `${ordered.length} 个已安装 · ${enabledCount} 个启用中 · 拖动可调整扩展侧栏里的顺序`
              : '正在读取…'}
          </p>
        </div>

        <button
          type="button"
          className="btn"
          data-size="sm"
          onClick={() => void load().catch(() => toast('扩展列表刷新失败', 'error'))}
        >
          <IconRefresh size={14} />
          重新读取
        </button>
      </div>

      {!loaded && !error ? (
        <div className="empty">
          <IconLoader size={22} />
        </div>
      ) : null}

      {error ? (
        <EmptyState
          icon={<IconPuzzle size={26} />}
          title="扩展列表打不开"
          description={error}
          action={
            <button
              type="button"
              className="btn"
              data-size="sm"
              onClick={() => void load().catch(() => undefined)}
            >
              重试
            </button>
          }
        />
      ) : null}

      {loaded && !error && ordered.length === 0 ? (
        <EmptyState
          icon={<IconPuzzle size={26} />}
          title="还没有安装扩展"
          description="左侧「插件商店」里能直接装；也可以装本地打包好的 .jsplugin.zip。"
        />
      ) : null}

      {loaded && !error && ordered.length > 0 ? (
        <ul className="extension-list">
          {ordered.map((plugin, index) => (
            <ExtensionRow
              key={plugin.id}
              plugin={plugin}
              dragging={dragIndex === index}
              // 拖到自己头上不算落点，否则会画出一条毫无意义的指示线
              over={overIndex === index && dragIndex !== null && dragIndex !== index}
              onDragStart={() => setDragIndex(index)}
              onDragOver={() => setOverIndex(index)}
              onDrop={() => dropAt(index)}
              onDragEnd={() => {
                setDragIndex(null)
                setOverIndex(null)
              }}
              onToggle={(next) => toggle(plugin, next)}
              onUninstall={() => uninstall(plugin)}
            />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────── 单行 ─────────────────────────────── */

interface ExtensionRowProps {
  plugin: JSPlugin
  dragging: boolean
  over: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onToggle: (next: boolean) => void
  onUninstall: () => void
}

function ExtensionRow({
  plugin,
  dragging,
  over,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onToggle,
  onUninstall
}: ExtensionRowProps): React.JSX.Element {
  const name = pluginDisplayName(plugin)
  const enabled = plugin.status === 'active'

  return (
    <li
      className="extension-row"
      data-dragging={dragging ? 'true' : undefined}
      data-over={over ? 'true' : undefined}
      data-enabled={enabled ? 'true' : 'false'}
      // 整行可拖：抓手只是个提示 —— 只让抓手能拖的话，用户十有八九会去拽行本身，
      // 然后发现拖不动，再怀疑这个功能坏了
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        // 不 preventDefault 的话浏览器会拒绝这个落点，onDrop 根本不触发
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
    >
      <span className="extension-grip" aria-hidden="true">
        <IconGrip size={16} />
      </span>

      <PluginIcon plugin={plugin} size={34} />

      <div className="extension-info">
        <div className="extension-name">
          {name}
          {plugin.status === 'error' ? (
            // 「运行异常」不是坏了：后端在指数退避重试，入口位上暂时不出现
            <span className="badge" data-tone="warning">
              运行异常
            </span>
          ) : null}
        </div>
        <div className="extension-meta truncate">
          {[`v${plugin.version || '—'}`, plugin.author, plugin.description]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>

      <Switch checked={enabled} onChange={onToggle} ariaLabel={`启用 ${name}`} />

      <button
        type="button"
        className="icon-btn"
        data-tip="卸载"
        aria-label={`卸载 ${name}`}
        onClick={onUninstall}
      >
        <IconTrash size={16} />
      </button>
    </li>
  )
}
