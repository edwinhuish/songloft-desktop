/**
 * 用户数据（设置 / 凭据 / 缓存）落在哪儿 —— 免安装版那一档。
 *
 * 只有主进程用（src/main/index.ts 在启动最前面调一次），放 shared/ 是因为它是一段**纯逻辑**：
 * 不碰文件系统，「标记在不在 → 该用哪个目录」「三档谁压谁」全在这里定下来，因此可以直接单测。
 *
 * ★ 别 import node:path —— shared/ 里的模块两侧都会被打包，渲染层那边没有 node 内置模块。
 *   路径拼接因此是手写的（只有一处，见 portableDataDir）。
 */

/**
 * 免安装（绿色）版的标记文件名。
 *
 * exe 旁边有它，就说明「这一份是解压出来的」，而不是 NSIS 装出来的。
 *
 * ★ 它由打包配置放进去（electron-builder.yml 的 `win.extraFiles`），而**安装包会在装完之后把它
 *   删掉**（build/installer.nsh 的 customInstall）。两半是同一件事，缺任何一个都会静默走错方向：
 *   * 只放不删 → 装出来的应用也会把配置写进安装目录，「卸载 / 换安装目录」就把用户数据一起弄丢；
 *   * 只删不放 → 绿色版永远拿不到这份数据目录，退化成「免安装但配置还在 %APPDATA%」。
 *   electron-builder 没有「只给某个 target 加文件」的口子，所以是「平台级放进去、安装时删掉」。
 */
export const PORTABLE_MARKER_FILE = 'portable.txt'

/**
 * 免安装版的数据目录名。
 *
 * 放在 exe 旁边的普通目录、名字也叫 data：绿色版的意思就是「整个文件夹拷走就带走了全部配置」，
 * 配置在哪儿得让人一眼看得见，所以不做成隐藏目录。
 *
 * ★ 实测（拿打包产物在等价路径上跑过一次）：绿色模式下，系统默认那个目录**仍会被建出来、且是空的**
 *   —— Chromium 在应用初始化时就把它建了，与这里选哪个目录无关。所以对外那句话要说成「不在本机
 *   留**数据**」，别写成「不留痕迹」；那个空目录删掉也不影响使用（给用户的说法见 build/portable.txt）。
 */
export const PORTABLE_DATA_DIR = 'data'

/**
 * 免安装版该用的数据目录；exe 旁边没有那个标记时返回 null（= 这事不归免安装版管）。
 *
 * 只看标记、不看别的：安装版的目录（`%LOCALAPPDATA%\Programs\…`，或用户自己选的 `D:\…`）同样
 * 写得进去，所以「可写」根本区分不出两者；能区分的就是那个标记文件。
 */
export function portableDataDir(exeDir: string, markerPresent: boolean): string | null {
  if (!markerPresent) return null

  const base = exeDir.replace(/[\\/]+$/, '')
  // 分隔符跟着传进来的目录走：Windows 上给 `\`，别混进 `/` —— 用户会把这里拼出来的路径
  // 复制到资源管理器 / 命令行里用（node:path 在这儿用不了，理由见文件头）。
  const sep = base.includes('\\') ? '\\' : '/'
  return `${base}${sep}${PORTABLE_DATA_DIR}`
}

export interface UserDataChoice {
  /** SONGLOFT_USER_DATA：显式指定，压过下面两档。空串 = 没指定 */
  override: string
  /** 免安装版那一档。只有「exe 旁边真有标记」且「那个目录真建得出来」时才有值，见主进程 */
  portableDir: string | null
  /** 系统默认位置（`app.getPath('userData')`） */
  fallback: string
}

/**
 * 三档里挑一个：显式指定 > 免安装版的数据目录 > 系统默认位置。
 *
 * 顺序不能换：前两档都是「用户或发行版明确说了要这样」，只有它们都没说话时，才轮到系统默认
 * 位置兜底。显式指定排第一是因为它也是自动化测试用的口子（scripts/e2e/run.sh 靠它把配置挪到
 * 临时目录），测试跑在绿色版上时不该被 exe 旁边的标记抢走。
 */
export function chooseUserDataDir(choice: UserDataChoice): string {
  return choice.override || choice.portableDir || choice.fallback
}
