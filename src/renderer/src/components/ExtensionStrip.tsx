/**
 * 标题栏扩展入口条。
 *
 * 一排「图标 + 名称」，**靠左对齐**（紧挨 LOGO），装不下的从右边裁掉、由折叠菜单接住。
 * 布局上它是标题栏中段那个吃掉所有余量的容器：右侧那组（菜单 / 搜索 / 窗口控制）靠它
 * 顶到右缘，它自己剩下来的空档就是拖拽区。
 *
 * 三个必须做对的地方：
 *   * 按钮一律 `<button>`：只有按钮才吃得到 base.css 里 `.titlebar button { no-drag }`
 *     那条兜底，否则点击会被拖窗口吃掉（标题栏整块是拖拽区）；
 *   * 提示写 `data-tip`，不写 `title=`（浏览器自带黑框不跟主题，见 AGENTS.md）；
 *   * 右键菜单复用 ContextMenuHost，不自己造下拉。
 */

import { useEffect, useRef } from 'react'

import { pluginDisplayName, type JSPlugin } from '@shared/plugin'
import { openMenuFromEvent } from './ContextMenu'
import { IconMusic } from './Icons'
import { PluginIcon } from './PluginIcon'
import { useExtensionStrip } from '@/hooks/useExtensionStrip'
import { useExtensionRuntime, usePlugins } from '@/state/usePlugins'
import { useUi } from '@/state/useUi'

/**
 * 判定「露不露得出来」时留的余量（px）。
 *
 * 亚像素宽度会让「刚好贴边」与「被裁掉一个角」差不到 1px，而这两者的后果天差地别：
 * 判成露着，那个扩展就不进折叠菜单，它便**没有任何入口**了。所以统一往严的那边靠。
 */
const CLIP_EPSILON = 1

export function ExtensionStrip(): React.JSX.Element {
  const { ordered, setCapacity, activate } = useExtensionStrip()
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = stripRef.current
    if (!node) return

    /**
     * 数一数有几个**完整**落在可视宽度里。
     *
     * 拿 `offsetLeft` 而不是 `getBoundingClientRect`：后者受祖先可能有的变换影响，
     * 而且每次读取都会强制同步布局。
     *
     * 一旦某个的右边界越界，后面的一定也越界，所以可以提前 break —— 这不仅快，
     * 还顺带把「露出来的必然是一段前缀」这件事写死在算法里（与 `.slice(capacity)` 一致）。
     */
    const measure = (): void => {
      const available = node.clientWidth
      if (!available) return
      let count = 0
      for (const child of Array.from(node.children)) {
        const item = child as HTMLElement
        // 留 1px 余量，宁可把一个其实刚好放得下的算成「藏了」，也不能把被裁掉一个角的
        // 算成「露着」—— 菜单是那些扩展**唯一**的入口，判错一次它就再也点不到了
        if (item.offsetLeft + item.offsetWidth > available - CLIP_EPSILON) break
        count += 1
      }
      setCapacity(count)
    }

    // 同时盯住容器与每个按钮：换主题字号、字体回退、名称变长都可能改变按钮宽度，
    // 而窗口尺寸和容器尺寸一点没变 —— 只观察容器会漏掉这些。
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    for (const child of Array.from(node.children)) observer.observe(child)
    // 首帧那次 ResizeObserver 回调不保证在绘制前到达，先手动量一遍，避免闪一下空条
    measure()

    return () => observer.disconnect()
  }, [ordered, setCapacity])

  return (
    // ★ 全部条目都渲染出来（超出的交给 CSS 的 overflow: hidden 裁掉）。
    //   不能只渲染「算出来的那几个」：按钮宽度随名称浮动，想量准个数就得先有得量。
    <div className="titlebar-extensions" ref={stripRef}>
      {ordered.map((plugin) => (
        <ExtensionButton
          key={plugin.entryPath}
          plugin={plugin}
          onClick={() => activate(plugin.entryPath)}
        />
      ))}
    </div>
  )
}

interface ExtensionButtonProps {
  plugin: JSPlugin
  onClick: () => void
}

function ExtensionButton({ plugin, onClick }: ExtensionButtonProps): React.JSX.Element {
  const entryPath = plugin.entryPath
  const runtime = useExtensionRuntime(entryPath)
  const toggleMuted = usePlugins((state) => state.toggleMuted)
  const active = useUi(
    (state) => state.route.name === 'plugin' && state.route.entryPath === entryPath
  )
  const name = pluginDisplayName(plugin)

  return (
    <button
      type="button"
      className="titlebar-ext"
      data-active={active ? 'true' : undefined}
      // 名称被省略号截断时，浮层里还能读到全名
      data-tip={name}
      aria-label={name}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      // 右键只放「静音」：这是宿主对扩展唯一能做的干预（见 PluginSurface —— guest 的
      // 音频只能整台静音，做不到按轨道调音量）。
      onContextMenu={(event) =>
        openMenuFromEvent(event, [
          {
            key: 'mute',
            label: runtime.muted ? '取消静音' : '静音',
            onClick: () => toggleMuted(entryPath)
          }
        ])
      }
    >
      {/* 蒙版只盖图标那一小块：按钮现在带着名称，整颗盖住会把名字糊掉 */}
      <span className="ext-icon">
        <PluginIcon plugin={plugin} size={17} />
        {runtime.playing ? (
          <span className="ext-playing" aria-hidden="true">
            <IconMusic size={10} />
          </span>
        ) : null}
      </span>
      <span className="ext-name">{name}</span>
    </button>
  )
}
