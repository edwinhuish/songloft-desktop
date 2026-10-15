/**
 * 曲库页的页头（见 pages/LibraryPage）：「曲库」大标题 + 副标题 + 来源切换。
 *
 * ★ 由**三种内容各摆一次**（曲库视图 / 文件夹视图 / 本地视图），而不是由 LibraryPage 摆一次：
 *   副标题是「这里现在有多少东西」，那个数字只有各自的视图知道。让视图把字符串往上报
 *   （父级 state + effect）等于为此多一次渲染、还要管「谁在报、谁负责清」；各自把这份页头
 *   摆在自己头上则什么都不用管。版式只有这一份实现，三处摆出来的是同一个东西。
 *
 * ★ 两行：第一行标题 + 副标题，第二行来源切换（右边是「服务器」那一半的两只看法切换）。
 *   副标题从「标题下面的一句话」搬到了标题右边，那一块就不能再是左右两栏的 .page-header
 *   —— 见 base.css 里 [data-stacked] 那一条。
 *
 * ★ `pane` 由调用方写死，**不是**从 useUi 读「当前路由」：页面槽是常驻的，不活跃的那一份
 *   读到的已经属于别人了（见 pages/LibraryPage 的说明）。
 */

import { LibraryViewSwitch } from './LibraryViewSwitch'
import { useAuth } from '@/state/useAuth'
import { useUi } from '@/state/useUi'

/** 这一页现在摆的是哪一份内容（三条路由一一对应，见 pages/LibraryPage） */
export type LibraryPane = 'library' | 'folders' | 'local'

export function LibraryHeader({
  pane,
  subtitle
}: {
  pane: LibraryPane
  /** 这一份内容现在有多少东西（数字只有各自的视图知道） */
  subtitle: string
}): React.JSX.Element {
  const navigate = useUi((s) => s.navigate)
  const guest = useAuth((s) => s.guest)
  const local = pane === 'local'

  return (
    <div className="page-header" data-stacked="true">
      <div className="page-headline">
        <h1 className="page-title">曲库</h1>
        {/* 副标题（「43 首」「5 个子文件夹 · 43 首歌」…）：跟标题同一行，放不下就省略 */}
        <div className="page-subtitle truncate">{subtitle}</div>
      </div>

      {/* ★ 免登录模式下这一整行不摆出来：服务器那一半的每一项都要会话（与侧栏同一口径 ——
          不是灰掉，是不摆出来），此时能看的本来就只有「本地」那一半 */}
      {guest ? null : (
        <div className="row-between" style={{ gap: 14 }}>
          {/* 来源切换（不是筛选）：所以走 .segmented，而不是筛选区那种 chip */}
          <div className="segmented" role="group" aria-label="曲库来源">
            <button
              type="button"
              aria-pressed={!local}
              /* 已经在「服务器」那一半时**什么都不做**：按着的是这一档，再点一下不该把人从
                 「文件夹」看法里拽回「曲库」看法 —— 换看法是右边那对图标钮的事 */
              onClick={() => {
                if (local) navigate({ name: 'library' })
              }}
            >
              服务器
            </button>
            <button type="button" aria-pressed={local} onClick={() => navigate({ name: 'local' })}>
              本地
            </button>
          </div>

          {/* 看法的切换（按标签 / 按文件夹）只在「服务器」这一半出现：本地那一半没有第二种
              看法可切 —— 它读的是本机磁盘上那批文件，既没有标签分面也没有目录树 */}
          {local ? null : <LibraryViewSwitch mode={pane} />}
        </div>
      )}
    </div>
  )
}
