/**
 * 标题栏扩展入口条。
 *
 * 布局上它是标题栏中段那个**吃掉所有余量**的容器：LOGO 在左、菜单与窗口控制在右，
 * 中间这块的宽度就是「留给入口条的可用宽度」。所以入口条不是「有几个画几个」，
 * 而是先量出宽度、算出装得下几个，再把装不下的交给折叠菜单（见 useExtensionStrip）。
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
 * 一个入口按钮占的宽度（含它与下一个之间的间隙）。
 *
 * 之所以是写死的常量而不是量出来的：入口按钮尺寸由 CSS 定，量单个按钮就得等它渲染完，
 * 于是「先有鸡还是先有蛋」—— 想算出装得下几个，得先渲染出来几个。固定尺寸把这个循环
 * 断开了，代价是这里的数字必须和 `.titlebar-ext` 的 width 保持一致。
 */
const BUTTON_WIDTH = 30
const BUTTON_GAP = 2

export function ExtensionStrip(): React.JSX.Element {
  const { visible, setCapacity, activate } = useExtensionStrip()
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = stripRef.current
    if (!node) return
    // ResizeObserver 而不是 window.resize：侧栏折叠、面板开合、主题换字号都可能改变
    // 这里能用的宽度，而窗口尺寸一点没变。
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setCapacity(Math.floor((width + BUTTON_GAP) / (BUTTON_WIDTH + BUTTON_GAP)))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [setCapacity])

  return (
    <div className="titlebar-extensions" ref={stripRef}>
      {visible.map((plugin) => (
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
      <PluginIcon plugin={plugin} size={17} />
      {runtime.playing ? (
        <span className="ext-playing" aria-hidden="true">
          <IconMusic size={9} />
        </span>
      ) : null}
    </button>
  )
}
