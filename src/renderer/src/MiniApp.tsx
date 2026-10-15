/**
 * 迷你窗的根（`#mini` 与 `#mini-host` 两个窗口都挂它，见 main.tsx）。
 *
 * 它与 App.tsx 是**两棵互不相干的界面树**：这里没有路由、没有侧栏、没有曲库，也没有会话 ——
 * 整窗只有一条播放条（外加它下面那块可展开的歌词 / 队列面板），见 components/MiniPlayer.tsx。
 *
 * ★ 同一个组件担着**两种身份**（判据是窗口角色，见 lib/window-role.ts）：
 *   · `#mini`      —— 跟随者（普通会话）：主窗口在旁边持着播放，这里只是它的一条播放条；
 *   · `#mini-host` —— 宿主（**本地文件会话**）：这里**就是**播放器 —— 双击音频文件起的那一趟
 *                     里没有主窗口（见 main/index.ts），起播、系统媒体控件、托盘与媒体键的
 *                     命令全得由这一窗自己接住（见 state/local-session）。
 *   界面对两种身份是同一套（读的都是 usePlayer，那边已经分好流），差别只在「接哪几条线」。
 *
 * 这里负责的只有「接线」这四件事，一件都不该散到别处：
 *   1. 读设置（主题 / 强调色 / 整窗浓度、以及迷你窗那**两块面板**各自的浓度 / 歌词字号，
 *      都靠它落到 <html> 上）；
 *      ★ 迷你窗**不建会话**：不 bootstrap、不碰凭据、不发任何业务请求。理由见 useAuth 的
 *        mirroredMedia —— 两个渲染层各持一个 ApiClient 会在刷新令牌轮换时互相踢下线。
 *        跟随者那一边需要的媒体地址与 token 由主窗口随快照喂进来；宿主那一边压根不用后端。
 *   2. 播放这一侧的接线：跟随者是订阅主窗口推来的状态（installMiniBridge），
 *      宿主是装配自己那一套（installLocalSession，起播也在那儿）；
 *   3. 报布局：条 / 面板 / 菜单三样一变就告诉主进程，窗口高度由它算（见 main/mini-window.ts）；
 *      ★ 菜单那一段也要报：它是页面里的 DOM，出不了窗口 —— 窗口得为它让出高度（MINI_MENU_HEIGHT），
 *        否则菜单会被窗口下边缘裁掉（见 shared/ipc.ts 那段常量说明）；
 *   4. 设置被**别的窗口**改了要跟着变（主进程推 settings:changed，见 shared/ipc.ts）。
 *      本地会话里没有别的窗口，这一条只是无害地接着 —— 它不必分身份。
 *
 * ★ 顺序上唯一要紧的是**先报尺寸、再 ready**：窗口在收到 ready 之前一直是隐藏的
 *   （见 main/mini-window.ts 的 openMiniWindow），所以「设置读完了、尺寸也摆对了」才让它露面
 *   —— 反过来的话用户会先看到一帧默认主题 + 默认高度的窗口。
 *   ★ 宿主那一侧还有一条：设置必须读完**才**装本地会话（primeAudio 与第一次起播都读它）。
 */

import { useEffect } from 'react'

import type { MiniWindowLayout } from '@shared/ipc'
import { ContextMenuHost, useContextMenu } from './components/ContextMenu'
import { MiniPlayer } from './components/MiniPlayer'
import { isMiniHost } from './lib/window-role'
import { installLocalSession } from './state/local-session'
import { installMiniBridge } from './state/remotePlayer'
import { selectPanelHeight, useMiniView } from './state/useMiniView'
import { useSettings } from './state/useSettings'

export function MiniApp(): React.JSX.Element {
  const host = isMiniHost()
  const panel = useMiniView((s) => s.panel)
  /** **当前那一块**面板的高度（两块各记一份，见 useMiniView 的 selectPanelHeight） */
  const panelHeight = useMiniView(selectPanelHeight)
  const menuOpen = useContextMenu((s) => s.open)

  /**
   * 接线（订阅设置推送、接上播放那一侧、报尺寸、要状态）。
   *
   * ★ 这里**不用** App.tsx 那种 `started` ref 的一次性守卫：StrictMode 会「挂上 → 卸下 →
   *   再挂上」，而守卫在第二次挂载时会直接 return —— 于是第一次挂载装好的订阅被那次卸下
   *   拆掉了，却再也没有人装回来（表现是迷你窗一片空白：状态永远推不进来）。
   *   下面的写法两次挂载都完整地装一遍、也完整地拆一遍，第二次挂载装上的那份才是活的。
   *   ★ 顺带的重复调用都是幂等的：`settings.load()` 是读一次的请求；`resize` / `ready`
   *   对主进程来说就是「摆尺寸」与「显示我」，重复一次没有副作用。
   */
  useEffect(() => {
    const disposeSettings = window.songloft.on.settingsChanged((next) => {
      useSettings.getState().apply(next)
    })
    /* 跟随者订阅主窗口推来的状态；宿主不订阅任何东西（它自己就是那份状态） */
    const disposeBridge = host ? null : installMiniBridge()
    let disposeSession: (() => void) | null = null
    let alive = true

    void (async () => {
      try {
        await useSettings.getState().load()
        /*
         * 面板高度是「上次拖出来的那一份」，两块**各有一份**（见 AppSettings 里那两个字段）：
         * 一次把两份都铺进去，之后切面板时用的就是各自那一份，不必在这里按当前面板挑。
         */
        const { settings } = useSettings.getState()
        useMiniView.getState().applyHeights({
          lyrics: settings.miniLyricsPanelHeight,
          queue: settings.miniQueuePanelHeight
        })
      } finally {
        /*
          ★ 这一段必须在 finally 里：读设置失败（IPC 出错、配置坏了）时若直接跳过，
            窗口就永远停在「隐藏」上 —— 用户点开迷你播放器，什么都没出现，也无从判断是
            哪一步断了。宁可带着默认设置露面（那时至少还能看到它、也能关掉它）。
        */
        /*
         * ★ alive 那道判断是必要的：这个 effect 可能已经被卸下（严格模式那两轮、或窗口
         *   正在关闭），这时不该再往一个已经走掉的组件上报尺寸、更不该开始放歌。
         */
        if (alive) {
          // 宿主：设置到位了再把播放那一侧接上（primeAudio 与起播都读设置，见 local-session）
          if (host) disposeSession = installLocalSession()
          await window.songloft.mini.resize(layout())
          await window.songloft.mini.ready()
        }
      }
    })()

    return () => {
      alive = false
      disposeSettings()
      disposeBridge?.()
      disposeSession?.()
    }
  }, [host])

  /*
   * 布局一变就报：面板开合、拖动面板、菜单开合都会改窗口高度。
   * 三个量必须**一起**报 —— 分两次的话主进程会在中间先摆出一个尺寸，那一下看得见。
   */
  useEffect(() => {
    void window.songloft.mini.resize({ expanded: panel !== null, panelHeight, menu: menuOpen })
  }, [panel, panelHeight, menuOpen])

  return (
    <>
      <MiniPlayer />
      {/* 菜单（那几根显示滑块）就挂在这里：它是**共享的**那一份下拉，见 components/ContextMenu */}
      <ContextMenuHost />
      {/*
        ★ 这里**不挂** TooltipHost：迷你窗整窗只有 64px 高的条（展开也只多一块面板），
          提示框一弹就盖住它自己那几颗钮，而这几颗钮本来就是「一看就懂 + aria-label 齐备」
          （条上所有按钮都与 data-tip 成对给了 aria-label）。渲染层那份 data-tip 也一并去掉了
          —— 不挂 host 的话它们只是看着像能用而已；主窗口那份照旧（见 App.tsx）。
      */}
    </>
  )
}

/** 此刻的布局：与上面那条 effect 算出的是同一件事（ready 之前要提前用一次） */
function layout(): MiniWindowLayout {
  const view = useMiniView.getState()
  return {
    expanded: view.panel !== null,
    // 同一份口径：**当前那一块**的高度（见 selectPanelHeight）
    panelHeight: selectPanelHeight(view),
    menu: useContextMenu.getState().open
  }
}
