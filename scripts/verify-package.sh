#!/usr/bin/env bash
# 离线自检：解开打包产物，断言桌面集成真的对了。
#
# 为什么要有它：桌面集成的错误**不会在构建时报错**，反馈路径又最贵（来自用户）。
# 所以把「装完才发现」的问题变成构建期断言。
#
# 需要：dpkg-deb（deb 分支）、产物本身（AppImage 分支自带 --appimage-extract，不需要 FUSE、不需要显示器）
# 用法：bash scripts/verify-package.sh [release 目录]
#
# ─────────────────────── 写这个脚本时踩过的几个坑 ───────────────────────
#
# 1. **别把「应用身份」定成以 `.desktop` 结尾的字符串。**
#    Electron 官方口径：`.desktop` 文件名 **去掉结尾那层 .desktop** == 应用身份
#    （就是 Wayland 的 app_id / X11 的 WM_CLASS，也是 .desktop 里的 StartupWMClass）。
#    若身份自己也以 `.desktop` 结尾（本仓库历史上用过 com.songloft.desktop，正好踩中），
#    「文件名 → 身份」这一步会多削掉一层，只能靠「多写一层后缀」抵消：
#        填 `com.songloft.desktop`         → 落地 `com.songloft.desktop`         → 身份变 `com.songloft`        ❌
#        填 `com.songloft.desktop.desktop` → 落地 `com.songloft.desktop.desktop` → 身份是 `com.songloft.desktop` ✅
#    两个字符串**视觉上都"以 .desktop 结尾"**，构建也不报错，唯一症状是 GNOME 里图标回落成
#    占位齿轮（GNOME 50 起还会让 xdg-desktop-portal 拒绝 globalShortcut 授权，且错误不冒到
#    应用层）。现在的取值 io.github.edwinhuish.songloft-desktop 不以 `.desktop` 结尾，
#    这一整类歧义消失。下面仍把「文件名 / StartupWMClass / setDesktopName() 入参」三者一起断言；
#    注意文件名要拿**推导值**（身份 + .desktop）比对，而不是直接比对 desktopName
#    —— 后者在 desktopName 自带后缀时会假失败。
#
# 2. **路径里有空格。** productName 是 "Songloft Desktop"，所以
#    `/opt/Songloft Desktop/...` 不能靠 `awk '{print $1}'` 或按空白切列来取。
#
# 3. **`set -o pipefail` + `grep -q` 会假阳性/假阴性。**
#    `tar -tzf x | grep -q y`：grep 命中就立刻退出并关掉管道，tar 收到 SIGPIPE
#    以非零退出，pipefail 把整条管道判为失败 —— 明明命中了却走到失败分支。
#    所以下面一律先把输出落成变量或文件，再单独 grep。
#
# 4. **别用 `$(函数)` 从「会打印报告的函数」里取值。**
#    check_desktop_file 既打印 ✓/✗ 又回传 Exec 值；`X="$(check_desktop_file ...)"`
#    会把整份报告当成 X，Exec 路径断言于是永远失败（且报错信息里塞满 ✓ 行）。
#    多返回值一律走全局变量（见 $DESKTOP_EXEC），别走 stdout。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${1:-$ROOT/release}"
EXECUTABLE="songloft-desktop"

bad()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; BAD=$((BAD + 1)); }
good() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
head_() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

BAD=0

# ★ 唯一事实源：package.json 的 desktopName。本项目约定写成**应用身份**本身
#   （反域名形态，不以 .desktop 结尾），原因见 AGENTS.md §8.1。
DESKTOP_NAME="$(node -p "require('$ROOT/package.json').desktopName" 2>/dev/null)"
[ -n "$DESKTOP_NAME" ] || { echo "package.json 缺少 desktopName" >&2; exit 2; }

# 身份 = desktopName 去掉结尾那层 .desktop（Electron 官方口径）。
# app.setDesktopName() 的入参、StartupWMClass 都用它。
APP_ID="${DESKTOP_NAME%.desktop}"
# 安装后的 .desktop 文件名 = 身份 + ".desktop"，也就是 electron-builder 的落地结果
# （getDesktopFileName() 削一层、FpmTarget 拼装时补一层）。断言文件名时用这个，
# 而不是直接用 desktopName —— 两者在「desktopName 已带 .desktop 后缀」时并不相等。
DESKTOP_FILE_NAME="${DESKTOP_NAME%.desktop}.desktop"

# 反向核对源码：setDesktopName 的入参必须与 desktopName 同源（去后缀后同为身份）
SOURCE_APP_ID="$(grep -oE "setDesktopName\(['\"][^'\"]+['\"]\)" "$ROOT/src/main/index.ts" 2>/dev/null \
  | head -1 | sed -E "s/setDesktopName\(['\"]([^'\"]+)['\"]\)/\1/")"
if [ -z "$SOURCE_APP_ID" ]; then
  bad "src/main/index.ts 里找不到 app.setDesktopName(...) —— 缺了它 GNOME 下会回落成占位图标"
elif [ "${SOURCE_APP_ID%.desktop}" != "$APP_ID" ]; then
  bad "setDesktopName('$SOURCE_APP_ID') 的身份与 desktopName('$DESKTOP_NAME') 不一致"
else
  good "身份 app_id=$APP_ID（desktopName 与 setDesktopName 同源）"
fi

# ── 挑一个放得下产物的临时目录 ──────────────────────────────────────────────
# 很多机器（含本机）的 /tmp 是 **10MB 的 tmpfs**，容不下解包一份 ~100MB 的 deb：
# `dpkg-deb -x` / `--appimage-extract` 里的 tar 会写到一半就 "设备上没有空间"，
# 于是解出来的 .desktop 是个**空文件** —— 最终表现成一串莫名其妙的断言失败
# （StartupWMClass=''、缺 Exec），而不是一句"空间不够"。所以先算需求、再选目录。
NEED_KB=0
for f in "$DIST"/*.deb "$DIST"/*.AppImage; do
  [ -f "$f" ] && NEED_KB=$((NEED_KB + $(stat -c '%s' "$f") / 1024))
done
# 解包后约为压缩包的 2 倍，另留 128MB 余量
NEED_KB=$((NEED_KB * 2 + 131072))

WORK_PARENT="${TMPDIR:-/tmp}"
AVAIL_KB="$(df -Pk "$WORK_PARENT" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt "$NEED_KB" ]; then
  warn "临时目录 $WORK_PARENT 可用约 $((AVAIL_KB / 1024))MB，解包需要约 $((NEED_KB / 1024))MB，改用项目内 .tmp/"
  WORK_PARENT="$ROOT/.tmp"
  mkdir -p "$WORK_PARENT"
fi

WORK="$(mktemp -d "$WORK_PARENT/songloft-verify-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 读 .desktop 里的键（大小写不敏感，取最后一个赋值）
desktop_key() { grep -iE "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '\r'; }

# 从 Exec 值里取出真正的可执行路径：去参数码、去外层双引号
exec_path_of() {
  printf '%s' "$1" | sed -E 's/[[:space:]]+%[fFuUdDnNickvm].*$//' | sed -E 's/^"//; s/"$//'
}

# ⚠️ Exec 值只能通过全局变量回传：good()/bad() 同样往 stdout 写，
#    若用 `X="$(check_desktop_file ...)"` 取值，捕获到的是**整份报告**而不是 Exec 值，
#    于是 Exec 路径存在性断言永远失败（2026-10-12 实测踩到）。
DESKTOP_EXEC=''

check_desktop_file() { # $1=.desktop 路径 $2=说明；Exec 值经 $DESKTOP_EXEC 回传
  local f="$1" label="$2" base wm exec_val
  DESKTOP_EXEC=''

  # 空文件 = 解包被截断（典型原因是临时目录空间不足）。先说清原因，
  # 否则下面会报出一串 "StartupWMClass=''" 这类把人带偏的失败。
  if [ ! -s "$f" ]; then
    bad "$label 的 .desktop 是空文件 —— 解包大概被磁盘空间截断了，检查临时目录可用空间"
    return 0
  fi

  base="$(basename "$f")"
  wm="$(desktop_key "$f" StartupWMClass)"
  exec_val="$(desktop_key "$f" Exec)"

  [ "$base" = "$DESKTOP_FILE_NAME" ] \
    && good "$label 条目文件名 $base" \
    || bad "$label 条目文件名是 $base，应为 $DESKTOP_FILE_NAME"

  [ "$wm" = "$APP_ID" ] \
    && good "$label StartupWMClass=$wm" \
    || bad "$label StartupWMClass='$wm'，应为 $APP_ID"

  [ -n "$exec_val" ] \
    && good "$label Exec=$exec_val" \
    || bad "$label 缺 Exec"
  [ -n "$(desktop_key "$f" Icon)" ] \
    && good "$label Icon=$(desktop_key "$f" Icon)" \
    || bad "$label 缺 Icon"

  DESKTOP_EXEC="$exec_val"
}

# ────────────────────────────────── deb ──────────────────────────────────
DEB="$(find "$DIST" -maxdepth 1 -name '*.deb' | head -1)"
if [ -z "$DEB" ]; then
  head_ "deb"
  warn "未找到 .deb（先跑 pnpm run pack:deb），跳过 deb 分支"
else
  head_ "deb: $(basename "$DEB")"
  dpkg-deb -x "$DEB" "$WORK/deb" || bad "dpkg-deb -x 失败"
  dpkg-deb -e "$DEB" "$WORK/ctl" || bad "提取 control 失败"

  # 1) .desktop（文件名断言见 check_desktop_file 的注释）
  DESKTOP_FILE="$(find "$WORK/deb/usr/share/applications" -maxdepth 1 -name '*.desktop' 2>/dev/null | head -1)"
  EXEC_VAL=''
  if [ -z "$DESKTOP_FILE" ]; then
    bad "包里没有 usr/share/applications/*.desktop"
  else
    check_desktop_file "$DESKTOP_FILE" 'deb'
    EXEC_VAL="$DESKTOP_EXEC"

    # 2) Exec 指向的可执行文件必须存在且可执行（路径含空格，不能按空白切列）
    EP="$(exec_path_of "$EXEC_VAL")"
    if [ -n "$EP" ] && [ -x "$WORK/deb$EP" ]; then
      good "可执行文件存在且可执行：$EP"
    else
      bad "Exec 指向的 '$EP' 在包里不存在或不可执行"
    fi

    # 3) hicolor 图标
    ICONS="$(find "$WORK/deb/usr/share/icons/hicolor" -name "$EXECUTABLE.png" 2>/dev/null)"
    [ -n "$ICONS" ] \
      && good "hicolor 图标已安装（$(printf '%s\n' "$ICONS" | wc -l | tr -d ' ') 个尺寸）" \
      || bad "usr/share/icons/hicolor 下缺少 $EXECUTABLE.png"
  fi

  # 4) extraResources：build/ 不进包，运行期要读的图标必须另投一份。
  #    注意装在 /opt/<productName>/resources/ 下，productName 带空格，只能 find。
  TRAY="$(find "$WORK/deb" -path '*/resources/tray.png' 2>/dev/null | head -1)"
  [ -n "$TRAY" ] \
    && good "resources/tray.png（托盘图标）在包里" \
    || bad "resources/tray.png 缺失 —— 托盘会显示不出图标"

  # 5) AppArmor：electron-builder 内建 profile + 我们给 AppImage 准备的那份
  BUILTIN="$(find "$WORK/deb" -path '*/resources/apparmor-profile' -type f 2>/dev/null | head -1)"
  [ -n "$BUILTIN" ] \
    && good "resources/apparmor-profile（electron-builder 内建，deb 自动安装）在包里" \
    || bad "resources/apparmor-profile 缺失"
  MANUAL="$(find "$WORK/deb" -path "*/resources/apparmor/$EXECUTABLE" -type f 2>/dev/null | head -1)"
  [ -n "$MANUAL" ] \
    && good "resources/apparmor/$EXECUTABLE（AppImage 手动安装用）在包里" \
    || bad "resources/apparmor/$EXECUTABLE 缺失"

  # 6) ★ 最关键的一条：postinst 引用的 profile 路径必须真的在包里。
  #    路径对不上时 postinst 只打印一行 "Skipping the installation..." 就继续了 ——
  #    安装「成功」、profile 从未生效，症状要等用户双击图标没反应才暴露。
  PROFILE_SRC="$(grep -oE "APPARMOR_PROFILE_SOURCE=['\"][^'\"]*['\"]" "$WORK/ctl/postinst" 2>/dev/null \
    | head -1 | sed -E "s/^[^=]+=//; s/^['\"]//; s/['\"]$//")"
  if [ -z "$PROFILE_SRC" ]; then
    warn "postinst 里没有 APPARMOR_PROFILE_SOURCE（electron-builder 版本可能换了写法）"
  elif [ -e "$WORK/deb$PROFILE_SRC" ]; then
    good "postinst 引用的 profile 确实在包里：$PROFILE_SRC"
  else
    bad "postinst 引用 $PROFILE_SRC，但包里没有 —— 安装时只会打印 Skipping，profile 永不生效"
  fi

  # 7) chrome-sandbox：755 是**正常**的（postinst 会探测 userns 支持，不支持才 4755），只警告
  SB="$(find "$WORK/deb" -name chrome-sandbox | head -1)"
  if [ -n "$SB" ]; then
    PERM="$(stat -c '%a' "$SB")"
    [ "$PERM" = "4755" ] \
      && warn "chrome-sandbox 权限 $PERM（走 setuid 兜底，说明 postinst 探测到系统不支持非特权 userns）" \
      || good "chrome-sandbox 权限 $PERM（正常：走 userns + AppArmor 那条路）"
  fi

  # 8) 依赖列表只打印不断言：默认列表由 electron-builder 生成，手写的会腐坏
  head_ "deb 元信息（仅供参考，不做断言）"
  grep -E '^(Package|Version|Depends|Recommends|Architecture):' "$WORK/ctl/control" || true
fi

# ──────────────────────────────── AppImage ────────────────────────────────
APPIMAGE="$(find "$DIST" -maxdepth 1 -name '*.AppImage' | head -1)"
if [ -z "$APPIMAGE" ]; then
  head_ "AppImage"
  warn "未找到 .AppImage（先跑 pnpm run pack:appimage），跳过 AppImage 分支"
else
  head_ "AppImage: $(basename "$APPIMAGE")"

  # 静态 runtime 不该再依赖 libfuse（先落变量，别在管道里用 grep -q）
  LDD_OUT="$(ldd "$APPIMAGE" 2>/dev/null || true)"
  if printf '%s' "$LDD_OUT" | grep -qi libfuse; then
    bad "AppImage 仍动态依赖 libfuse（toolsets.appimage 没生效？）"
  else
    good "无 libfuse 动态依赖（toolsets.appimage 静态 runtime 生效）"
  fi

  # --appimage-extract 本身就在验证 runtime 正常，且不需要 FUSE、不需要显示器
  ( cd "$WORK" && "$APPIMAGE" --appimage-extract >/dev/null 2>&1 ) \
    && good "--appimage-extract 成功" \
    || bad "--appimage-extract 失败（runtime 有问题）"

  APPDIR="$WORK/squashfs-root"
  if [ -d "$APPDIR" ]; then
    [ -x "$APPDIR/AppRun" ] && good "AppRun 可执行" || bad "AppRun 不存在或不可执行"

    AI_PROFILE="$(find "$APPDIR" -path "*/resources/apparmor/$EXECUTABLE" -type f 2>/dev/null | head -1)"
    [ -n "$AI_PROFILE" ] \
      && good "resources/apparmor/$EXECUTABLE 在包里" \
      || bad "resources/apparmor/$EXECUTABLE 缺失（AppImage 首次运行要手动装 profile）"

    # AppImage 顶层的 .desktop 会被 AppRun 装到用户目录
    AI_DESKTOP="$(find "$APPDIR" -maxdepth 1 -name '*.desktop' | head -1)"
    if [ -z "$AI_DESKTOP" ]; then
      bad "AppImage 内没有 .desktop"
    else
      check_desktop_file "$AI_DESKTOP" 'AppImage'
    fi
  fi
fi

# ────────────────────────────────── tar.gz ──────────────────────────────────
TARBALL="$(find "$DIST" -maxdepth 1 -name '*.tar.gz' | head -1)"
if [ -n "$TARBALL" ]; then
  head_ "tar.gz: $(basename "$TARBALL")"
  # ★ 先把清单落成变量：`tar | grep -q` 在 pipefail 下会因为 SIGPIPE 误判失败
  TAR_LIST="$(tar -tzf "$TARBALL" 2>/dev/null || true)"
  if printf '%s\n' "$TAR_LIST" | grep -qE "(^|/)$EXECUTABLE$"; then
    good "tar.gz 内含可执行文件 $EXECUTABLE"
  else
    bad "tar.gz 内找不到 $EXECUTABLE"
  fi
fi

head_ "结果"
if [ "$BAD" -gt 0 ]; then
  printf '\033[31m%d 项断言失败\033[0m\n' "$BAD" >&2
  exit 1
fi
printf '\033[32m全部断言通过\033[0m\n'
