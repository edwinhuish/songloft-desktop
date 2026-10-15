/**
 * 「曲库（按标签）/ 文件夹（按目录）」这两只看法的切换 —— 一对图标钮（见 pages/LibraryPage）。
 *
 * ★ 它从页头那颗分段钮搬到了工具条里（需求），于是**不属于页头**：只在页头画一次的话，
 *   进了文件夹就再也切不回曲库 —— 所以由**两个视图各画一次**（曲库视图的筛选行 /
 *   文件夹视图的动作行），页头那一格留给「服务器 / 本地」那颗来源切换。
 * ★ 走路由（library / folders）而不是本页 state：文件夹要能带着目录深链、面包屑要能一段段
 *   跳回去（见 useUi 的说明），而那一半只活在路由里。两条路由各占一个页面槽，所以切回来时
 *   两边各自的筛选条件都还在。
 * ★ 落点一律 `path: ''`：这一对钮是「换一只眼睛看曲库」，不是「回到我上次逛到的那个目录」——
 *   想回目录靠文件夹那一页自己的面包屑。
 */

import { IconFolder, IconLibrary } from './Icons'
import { useUi } from '@/state/useUi'

export function LibraryViewSwitch({ mode }: { mode: 'library' | 'folders' }): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)

  return (
    <div className="row" style={{ gap: 2, flex: 'none' }} role="group" aria-label="曲库视图">
      <button
        type="button"
        className="icon-btn"
        data-active={mode === 'library'}
        aria-pressed={mode === 'library'}
        aria-label="按标签浏览"
        data-tip="按标签浏览曲库"
        onClick={() => navigate({ name: 'library' })}
      >
        <IconLibrary size={16} />
      </button>
      <button
        type="button"
        className="icon-btn"
        data-active={mode === 'folders'}
        aria-pressed={mode === 'folders'}
        aria-label="按文件夹浏览"
        data-tip="按文件夹浏览曲库"
        onClick={() => navigate({ name: 'folders', path: '' })}
      >
        <IconFolder size={16} />
      </button>
    </div>
  )
}
