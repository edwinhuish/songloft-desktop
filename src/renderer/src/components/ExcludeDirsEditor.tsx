/**
 * 「排除目录」编辑器：名称排除 / 路径排除 / 歌单排除三个页签。
 *
 * 三者的作用域**并不一样**，界面上必须拆开讲清楚，否则用户会以为「歌单排除」也能拦住扫描：
 *   * 名称排除 → `exclude_dirs`           扫描时跳过（路径里任何一层目录名命中就整棵跳过）
 *   * 路径排除 → `exclude_paths`          扫描时跳过（该路径及其子树）
 *   * 歌单排除 → `auto_create_exclude_dirs`  **只**影响「自动创建歌单」，扫描照旧
 *
 * ★ 草稿由父组件持有：三个页签改的是同一个 `MusicPathSetting`。
 *   `PUT /settings/music-path` 是一次覆盖写（后端把缺席的数组当空数组落库），
 *   所以保存必须一次带上全部字段，不能每个页签各存各的 —— 否则先存名称再存路径，
 *   名称就被自己清空了。
 */

import { useEffect, useState } from 'react'

import type { DirEntry, MusicPathSetting } from '@shared/types'
import { IconCheck, IconClose, IconFolder, IconLoader, IconPlus } from './Icons'
import { getDirectories, getDirNames } from '@/api/endpoints'
import { useAsync } from '@/hooks/useAsync'
import { requireClient } from '@/state/useAuth'

type TabKey = 'name' | 'path' | 'playlist'

/** 页签 → 它写的那个字段 */
type FieldKey = 'exclude_dirs' | 'exclude_paths' | 'auto_create_exclude_dirs'

const TABS: { key: TabKey; label: string; field: FieldKey }[] = [
  { key: 'name', label: '名称排除', field: 'exclude_dirs' },
  { key: 'path', label: '路径排除', field: 'exclude_paths' },
  { key: 'playlist', label: '歌单排除', field: 'auto_create_exclude_dirs' }
]

const HINTS: Record<TabKey, string> = {
  name: '路径中任何一层出现同名目录都会被排除，扫描时跳过整棵子树',
  path: '排除某个具体路径以及它下面的所有内容（可配合下方的目录树点选）',
  playlist: '这些目录不会被自动创建成歌单，但歌照样会被扫描入库'
}

const PLACEHOLDERS: Record<TabKey, string> = {
  name: '输入目录名称，例如 Covers',
  path: '输入相对音乐根目录的路径，例如 Albums/Singles',
  playlist: '输入目录名称，例如 downloads'
}

const EMPTY: Record<TabKey, string> = {
  name: '还没有排除任何目录名',
  path: '还没有排除任何路径',
  playlist: '还没有排除任何目录（自动创建歌单会覆盖全部目录）'
}

const SUGGESTION_LIST_ID = 'exclude-dir-name-suggestions'

export interface ExcludeDirsEditorProps {
  value: MusicPathSetting
  onChange: (next: MusicPathSetting) => void
  /** 后端配置还没读到：PUT 必须带 path，这时不允许保存 */
  disabled?: boolean
  saving?: boolean
  onSave: () => void
}

export function ExcludeDirsEditor({
  value,
  onChange,
  disabled,
  saving,
  onSave
}: ExcludeDirsEditorProps): React.JSX.Element {
  const [tab, setTab] = useState<TabKey>('name')
  const [entry, setEntry] = useState('')

  const tabMeta = TABS.find((item) => item.key === tab) ?? TABS[0]
  const current = value[tabMeta.field]

  // 切页签就清空输入框：上一条是目录名、这一条要的是路径，留着只会被误提交
  useEffect(() => setEntry(''), [tab])

  // 目录名候选由后端递归收集（`/scan/dir-names`）；路径页签靠下面的目录树点选，不用它
  const dirNames = useAsync(() => getDirNames(requireClient()), [])
  const suggestions = tab === 'path' ? [] : (dirNames.data ?? [])

  const write = (next: string[]): void => onChange({ ...value, [tabMeta.field]: next })

  const add = (raw: string): void => {
    const item = raw.trim()
    if (!item || current.includes(item)) return
    write([...current, item])
    setEntry('')
  }

  const remove = (item: string): void => write(current.filter((x) => x !== item))

  const toggle = (item: string): void => {
    if (current.includes(item)) remove(item)
    else write([...current, item])
  }

  return (
    <div className="exclude-editor">
      <div className="row-between" style={{ gap: 12 }}>
        <div className="segmented" role="group" aria-label="排除方式">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={tab === item.key}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn"
          data-variant="primary"
          disabled={disabled || saving}
          onClick={onSave}
        >
          {saving ? <IconLoader size={15} /> : <IconCheck size={15} />}
          保存排除配置
        </button>
      </div>

      <div className="field-hint" style={{ marginTop: 10 }}>
        {HINTS[tab]}
      </div>

      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          className="input"
          value={entry}
          list={suggestions.length > 0 ? SUGGESTION_LIST_ID : undefined}
          placeholder={PLACEHOLDERS[tab]}
          aria-label={PLACEHOLDERS[tab]}
          onChange={(event) => setEntry(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') add(entry)
          }}
        />
        <button
          type="button"
          className="btn"
          style={{ flex: 'none' }}
          disabled={!entry.trim()}
          onClick={() => add(entry)}
        >
          <IconPlus size={15} />
          添加
        </button>
      </div>

      {suggestions.length > 0 ? (
        <datalist id={SUGGESTION_LIST_ID}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      ) : null}

      {current.length > 0 ? (
        <div className="chip-row" style={{ marginTop: 10 }}>
          {current.map((item) => (
            <button
              key={item}
              type="button"
              className="chip"
              title={`移除 ${item}`}
              aria-label={`移除排除项 ${item}`}
              onClick={() => remove(item)}
            >
              <span className="truncate" style={{ maxWidth: 280 }}>
                {item}
              </span>
              <IconClose size={12} />
            </button>
          ))}
        </div>
      ) : (
        <div className="field-hint" style={{ marginTop: 10 }}>
          {EMPTY[tab]}
        </div>
      )}

      {tab === 'path' ? (
        <DirTree musicPath={value.path} selected={current} onToggle={toggle} />
      ) : null}
    </div>
  )
}

/* ─────────────────────────── 目录树（路径页签用） ─────────────────────────── */

interface TreeContext {
  selected: string[]
  expanded: string[]
  onToggleExpand: (path: string) => void
  onToggle: (path: string) => void
}

/**
 * 懒加载的目录树：一层一个 `/scan/directories?path=` 请求。
 * 点文件夹名 = 加入/移出排除路径（而不是「进入」），所以不需要选中态之外的状态。
 */
function DirTree({
  musicPath,
  selected,
  onToggle
}: {
  musicPath: string
  selected: string[]
  onToggle: (path: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<string[]>([])
  const root = useAsync(() => getDirectories(requireClient(), ''), [])

  const onToggleExpand = (path: string): void =>
    setExpanded((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    )

  const context: TreeContext = { selected, expanded, onToggleExpand, onToggle }

  return (
    <div className="dir-tree">
      <div className="field-hint">
        {root.loading
          ? '正在读取音乐目录…'
          : `点文件夹名加入/移出排除：${root.data?.root || musicPath}`}
      </div>
      {root.error ? <div className="field-hint">{root.error}</div> : null}
      {(root.data?.directories ?? []).map((entry) => (
        <DirNode key={entry.path} entry={entry} depth={0} context={context} />
      ))}
    </div>
  )
}

function DirNode({
  entry,
  depth,
  context
}: {
  entry: DirEntry
  depth: number
  context: TreeContext
}): React.JSX.Element {
  const open = context.expanded.includes(entry.path)
  const active = context.selected.includes(entry.path)

  return (
    <>
      <div className="dir-node" style={{ paddingLeft: depth * 14 }}>
        <button
          type="button"
          className="dir-caret"
          disabled={!entry.has_children}
          aria-label={entry.has_children ? `${open ? '收起' : '展开'} ${entry.name}` : entry.name}
          onClick={() => context.onToggleExpand(entry.path)}
        >
          {entry.has_children ? <span data-open={open}>▸</span> : null}
        </button>
        <button
          type="button"
          className="dir-name"
          aria-pressed={active}
          title={entry.path}
          onClick={() => context.onToggle(entry.path)}
        >
          <IconFolder size={15} />
          <span className="truncate">{entry.name}</span>
        </button>
        {active ? <IconCheck size={13} /> : null}
      </div>
      {open ? <DirChildren path={entry.path} depth={depth + 1} context={context} /> : null}
    </>
  )
}

/** 展开后的下一层：单独一个组件，才能让每一层各自持有自己的请求与 loading */
function DirChildren({
  path,
  depth,
  context
}: {
  path: string
  depth: number
  context: TreeContext
}): React.JSX.Element {
  const result = useAsync(() => getDirectories(requireClient(), path), [path])

  if (result.error) {
    return (
      <div className="dir-node" style={{ paddingLeft: depth * 14 + 26 }}>
        <span className="field-hint">{result.error}</span>
      </div>
    )
  }
  if (result.loading && !result.data) {
    return (
      <div className="dir-node" style={{ paddingLeft: depth * 14 + 26 }}>
        <span className="field-hint">正在读取…</span>
      </div>
    )
  }

  const children = result.data?.directories ?? []
  if (children.length === 0) {
    return (
      <div className="dir-node" style={{ paddingLeft: depth * 14 + 26 }}>
        <span className="field-hint">没有子目录</span>
      </div>
    )
  }

  return (
    <>
      {children.map((entry) => (
        <DirNode key={entry.path} entry={entry} depth={depth} context={context} />
      ))}
    </>
  )
}
