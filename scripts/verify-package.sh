#!/usr/bin/env bash
# 离线自检：解开打包产物，断言桌面集成真的对了。
#
# 为什么要有它：桌面集成的错误**不会在构建时报错**，反馈路径又最贵（来自用户）。
# 所以把「装完才发现」的问题变成构建期断言。
#
# 需要：dpkg-deb（deb 分支）、产物本身（AppImage 分支自带 --appimage-extract，不需要 FUSE、不需要显示器）
# 用法：bash scripts/verify-package.sh [release 目录]
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="${1:-$ROOT/release}"
EXECUTABLE="songloft-desktop"

bad()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; BAD=$((BAD + 1)); }
good() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
head_() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

BAD=0

# ★ 唯一事实源：package.json 的 desktopName。桌面条目**文件名**、StartupWMClass、
#   以及 src/main 里 app.setDesktopName() 的入参三处必须同源。
DESKTOP_NAME="$(node -p "require('$ROOT/package.json').desktopName")"
[ -n "$DESKTOP_NAME" ] || { echo "package.json 缺少 desktopName" >&2; exit 2; }

# 反向核对源码：setDesktopName 的入参必须等于 desktopName + '.desktop'
SOURCE_APP_ID="$(grep -oE "setDesktopName\(['\"][^'\"]+['\"]\)" "$ROOT/src/main/index.ts" 2>/dev/null \
  | head -1 | sed -E "s/setDesktopName\(['\"]([^'\"]+)['\"]\)/\1/")"
if [ -z "$SOURCE_APP_ID" ]; then
  bad "src/main/index.ts 里找不到 app.setDesktopName(...) —— 缺了它 GNOME 下会回落成占位图标"
elif [ "$SOURCE_APP_ID" != "$DESKTOP_NAME.desktop" ]; then
  bad "setDesktopName('$SOURCE_APP_ID') 与 package.json 的 desktopName('$DESKTOP_NAME') 不一致"
else
  good "setDesktopName 与 desktopName 同源：$SOURCE_APP_ID"
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/songloft-verify-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 读 .desktop 里的键（大小写不敏感，取最后一个赋值）
desktop_key() { grep -iE "^$2=" "$1" | tail -1 | cut -d= -f2- | tr -d '\r'; }

check_desktop_file() { # $1=.desktop 路径 $2=说明
  local f="$1" label="$2" base wm
  base="$(basename "$f")"
  wm="$(desktop_key "$f" StartupWMClass)"

  [ "$base" = "$DESKTOP_NAME.desktop" ] \
    && good "$label 条目文件名 $base" \
    || bad "$label 条目文件名是 $base，应为 $DESKTOP_NAME.desktop（electron-builder 的 linux.syncDesktopName 没开就会这样）"

  [ "$wm" = "$DESKTOP_NAME" ] \
    && good "$label StartupWMClass=$wm" \
    || bad "$label StartupWMClass='$wm'，应为 $DESKTOP_NAME"

  [ -n "$(desktop_key "$f" Exec)" ] \
    && good "$label Exec=$(desktop_key "$f" Exec)" \
    || bad "$label 缺 Exec"
  [ -n "$(desktop_key "$f" Icon)" ] \
    && good "$label Icon=$(desktop_key "$f" Icon)" \
    || bad "$label 缺 Icon"
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

  # 1) .desktop
  DESKTOP_FILE="$(find "$WORK/deb/usr/share/applications" -maxdepth 1 -name '*.desktop' 2>/dev/null | head -1)"
  if [ -z "$DESKTOP_FILE" ]; then
    bad "包里没有 usr/share/applications/*.desktop"
  else
    check_desktop_file "$DESKTOP_FILE" 'deb'

    # 2) Exec 指向的可执行文件必须存在且可执行
    EXEC_PATH="$(desktop_key "$DESKTOP_FILE" Exec | awk '{print $1}')"
    if [ -x "$WORK/deb$EXEC_PATH" ]; then
      good "可执行文件存在且可执行：$EXEC_PATH"
    else
      bad "Exec 指向的 $EXEC_PATH 在包里不存在或不可执行"
    fi

    # 3) hicolor 图标
    if find "$WORK/deb/usr/share/icons/hicolor" -name "$EXECUTABLE.png" 2>/dev/null | grep -q .; then
      good "hicolor 图标已安装"
    else
      bad "usr/share/icons/hicolor 下缺少 $EXECUTABLE.png"
    fi
  fi

  # 4) extraResources（build/ 不进包，运行期要读的图标必须另投一份）
  [ -f "$WORK/deb/resources/tray.png" ] \
    && good "resources/tray.png（托盘图标）在包里" \
    || bad "resources/tray.png 缺失 —— 托盘会显示不出图标"

  # 5) AppArmor：electron-builder 内建 profile + 我们给 AppImage 准备的那份
  [ -f "$WORK/deb/resources/apparmor-profile" ] \
    && good "resources/apparmor-profile（electron-builder 内建，deb 自动安装）在包里" \
    || bad "resources/apparmor-profile 缺失"
  [ -f "$WORK/deb/resources/apparmor/$EXECUTABLE" ] \
    && good "resources/apparmor/$EXECUTABLE（AppImage 手动安装用）在包里" \
    || bad "resources/apparmor/$EXECUTABLE 缺失"

  # 6) ★ 最关键的一条：postinst 引用的 profile 路径必须真的在包里。
  #    路径对不上时 postinst 只打印一行 "Skipping the installation..." 就继续了 ——
  #    安装「成功」、profile 从未生效，症状要等用户双击图标没反应才暴露。
  PROFILE_SRC="$(grep -oE "APPARMOR_PROFILE_SOURCE=['\"][^'\"]*['\"]" "$WORK/ctl/postinst" 2>/dev/null \
    | head -1 | cut -d\' -f2 | cut -d'"' -f2)"
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

  # 静态 runtime 不该再依赖 libfuse
  if ldd "$APPIMAGE" 2>/dev/null | grep -qi libfuse; then
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
    [ -f "$APPDIR/resources/apparmor/$EXECUTABLE" ] \
      && good "resources/apparmor/$EXECUTABLE 在包里" \
      || bad "resources/apparmor/$EXECUTABLE 缺失（AppImage 首次运行要手动装 profile）"

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
  tar -tzf "$TARBALL" | grep -q "/$EXECUTABLE$" \
    && good "tar.gz 内含可执行文件 $EXECUTABLE" \
    || bad "tar.gz 内找不到 $EXECUTABLE"
fi

head_ "结果"
if [ "$BAD" -gt 0 ]; then
  printf '\033[31m%d 项断言失败\033[0m\n' "$BAD" >&2
  exit 1
fi
printf '\033[32m全部断言通过\033[0m\n'
