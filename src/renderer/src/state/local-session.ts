/**
 * **本地文件会话**：迷你宿主窗的启动编排。
 *
 * 「双击一个音频文件就开始放，而且只起一个迷你播放器」这件事落到这里：那一趟里压根没有主窗口
 * （见 main/index.ts），于是平时由主窗口担着的几件事 —— 起播、把播放状态推给系统、把托盘与
 * 媒体键的命令落下来 —— 必须由**迷你窗自己**接住。这个模块就是那份清单，一处收口。
 *
 * 装什么、各自为什么：
 *   · `primeAudio` —— 音量与播放模式从设置里来，必须赶在**第一次起播之前**，否则第一首歌
 *     按默认音量出声；
 *   · `watchSystemTheme` —— 普通迷你窗靠主窗口推 `settings:changed` 跟主题走，本地会话里
 *     没有那个窗口，`theme = 'system'` 时就只剩这条路；
 *   · `installMediaSessionHandlers` / `installNowPlayingSync` —— 系统媒体控件（Linux 的 MPRIS、
 *     Windows 的 SMTC、macOS 的 Now Playing）与托盘快照都读它们。音频在**这个**窗口里，
 *     所以必须挂在这儿，不然系统里那套「正在播放」是空的、托盘也一直是「未在播放」；
 *   · `installMediaCommands` —— 托盘菜单与全局媒体键发来的命令（主进程只把它送给宿主窗口，
 *     见 main/index.ts 的 sendToHost）。「显示/收起歌词」在这里落到下方那块歌词面板上；
 *   · `installLocalFileIntake` —— 双击关联 / 命令行 / 菜单带来的路径，取走即播（「排队 + 来取」，
 *     见 useLocalFiles）。**这一步就是「文件打开后自动开始播放」**。
 *
 * ★ 刻意**不装** installMetadataWatch：那是起播时去问后端补元数据（封面 / 歌词 / 歌手），
 *   而这一趟里没有会话，本地文件的 id 又是负的（后端不认识它，见 song-metadata 的第一道判断）
 *   —— 装了也只是每次起播白跑一次判断。
 *
 * ★ 调用方必须**先把设置读完**（MiniApp 就是这么排的）：primeAudio 与随后那次起播都依赖
 *   设置里的音量与播放模式。
 *
 * ★ 这里不建会话、不 bootstrap、不发任何业务请求：本地文件读的是本机磁盘（见 useAuth 的
 *   guest / mirroredMedia 那两段说明，迷你窗不持有 ApiClient 是刻意的）。
 */

import { installMediaCommands } from './media-commands'
import { installLocalFileIntake } from './useLocalFiles'
import { useMiniView } from './useMiniView'
import { installMediaSessionHandlers, installNowPlayingSync, primeAudio } from './usePlayer'
import { watchSystemTheme } from './useSettings'

export function installLocalSession(): () => void {
  primeAudio()

  const disposers = [
    watchSystemTheme(),
    installMediaSessionHandlers(),
    installNowPlayingSync(),
    installMediaCommands({ toggleLyrics: () => useMiniView.getState().togglePanel('lyrics') }),
    installLocalFileIntake()
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}
