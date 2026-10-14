/**
 * 迷你窗的根（只在 `#mini` 那个窗口里挂，见 main.tsx）。
 *
 * 它与 App.tsx 是**两棵互不相干的界面树**：这里没有路由、没有侧栏、没有曲库，也没有会话 ——
 * 整窗只有一条播放条（外加它下面那块可展开的歌词 / 队列面板），见 components/MiniPlayer.tsx。
 *
 * 这里负责的只有「接线」这四件事，一件都不该散到别处：
 *   1. 读设置（主题 / 强调色 / 两份不透明度 / 歌词字号都靠它落到 <html> 上）；
 *      ★ 迷你窗**不建会话**：不 bootstrap、不碰凭据、不发任何业务请求。理由见 useAuth 的
 *        mirroredMedia —— 两个渲染层各持一个 ApiClient 会在刷新令牌轮换时互相踢下线。
 *        它需要的媒体地址与 token 由主窗口随快照喂进来。
 *   2. 订阅主窗口推来的播放状态（state/remotePlayer 的 installMiniBridge）；
 *   3. 报布局：条 / 面板 / 菜单三样一变就告诉主进程，窗口高度由它算（见 main/mini-window.ts）；
 *   4. 设置被主窗口改了要跟着变（主进程推 settings:changed，见 shared/ipc.ts）。
 *
 * ★ 顺序上唯一要紧的是**先报尺寸、再 ready**：窗口在收到 ready 之前一直是隐藏的
 *   （见 main/mini-window.ts 的 openMiniWindow），所以「设置读完了、尺寸也摆对了」才让它露面
 *   —— 反过来的话用户会先看到一帧默认主题 + 默认高度的窗口。
 */

import { useEffect } from 'react'

import type { MiniWindowLayout } from '@shared/ipc'
import { ContextMenuHost, useContextMenu } from './components/ContextMenu'
import { MiniPlayer } from './components/MiniPlayer'
import { installMiniBridge } from './state/remotePlayer'
import { useMiniView } from './state/useMiniView'
import { useSettings } from './state/useSettings'

export function MiniApp(): React.JSX.Element {
  const panel = useMiniView((s) => s.panel)
  const panelHeight = useMiniView((s) => s.panelHeight)
  const menuOpen = useContextMenu((s) => s.open)

  /**
   * 接线（订阅设置推送、订阅播放状态、报尺寸、要状态）。
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
    const disposeBridge = installMiniBridge()

    void (async () => {
      try {
        await useSettings.getState().load()
        // 面板高度是「上次拖出来的那一份」（见 AppSettings.miniPanelHeight）
        useMiniView.getState().setPanelHeight(useSettings.getState().settings.miniPanelHeight)
      } finally {
        /*
          ★ 这一段必须在 finally 里：读设置失败（IPC 出错、配置坏了）时若直接跳过，
            窗口就永远停在「隐藏」上 —— 用户点开迷你播放器，什么都没出现，也无从判断是
            哪一步断了。宁可带着默认设置露面（那时至少还能看到它、也能关掉它）。
        */
        await window.songloft.mini.resize(layout())
        await window.songloft.mini.ready()
      }
    })()

    return () => {
      disposeSettings()
      disposeBridge()
    }
  }, [])

  /* 布局一变就报（面板开合、拖动面板、右键菜单开合都会改窗口高度） */
  useEffect(() => {
    void window.songloft.mini.resize({ expanded: panel !== null, panelHeight, menu: menuOpen })
  }, [panel, panelHeight, menuOpen])

  return (
    <>
      <MiniPlayer />
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
    panelHeight: view.panelHeight,
    menu: useContextMenu.getState().open
  }
}
