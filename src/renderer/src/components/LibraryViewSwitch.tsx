/**
 * 「按标签浏览 / 按文件夹浏览」这两只看法之间的切换 —— 一对图标钮。
 *
 * ★ 它摆在页头第二行的右端（见 components/LibraryHeader），**与来源切换同一行**：两种看法下
 *   页头都是同一个组件、同一份版式，所以切过去之后那颗钮还在原处，一眼就能切回来。
 *   「服务器 / 本地」选中「本地」时整对钮不出现 —— 那一半没有第二种看法可切。
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
