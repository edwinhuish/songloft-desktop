#!/usr/bin/env bash
#
# 把本应用注册到**当前用户**的桌面目录 —— 也就是 GNOME 认窗口图标要的那份 .desktop + 图标。
#
# ─────────────────────── 为什么要有这个脚本 ───────────────────────
#
# Wayland 下「窗口图标」这条路是不通的：`xdg_toplevel` 协议里没有图标字段，合成器至今也没
# 提供 `xdg-toplevel-icon-v1`，所以 BrowserWindow 的 icon（X11 的 _NET_WM_ICON）传不出去。
# GNOME 认图标只有一条链：
#
#     窗口上报的 app_id（= app.setDesktopName 的入参）
#       → 宿主上 $XDG_DATA_DIRS/applications/<app_id>.desktop   （以及 ~/.local/share 那份）
#       → 条目里的 Icon= 交给图标主题解析
#
# 而 AppImage / tar.gz / 开发态都**不往宿主目录装任何东西**：AppImage 里的条目躺在只读挂载点
# 里（gnome-shell 的 XDG_DATA_DIRS 根本不含它，而且退出后挂载点还会消失），开发态更是连
# 条目都不存在。于是任务栏里只剩一个占位齿轮 —— 这是 GNOME 的已知限制，不是产物坏了。
#
# 所以本项目把「写这份条目」做成一条**显式命令**（而不是应用启动时偷偷动 $HOME）：
# 想让它生效就跑一次，卸载同样一条命令。只写 $XDG_DATA_HOME（默认 ~/.local/share），
# 不碰 /usr、不需要 sudo，脚本会把它写的每个路径都打出来。
#
# 用法：
#   bash scripts/desktop-integration.sh install                    # 开发态：Exec = 本仓库的 electron
#   bash scripts/desktop-integration.sh install /path/App.AppImage  # 打包态：Exec = 指定的启动目标
#   bash scripts/desktop-integration.sh uninstall
#
# 写出的两份文件：
#   $XDG_DATA_HOME/applications/<身份>.desktop
#   $XDG_DATA_HOME/icons/hicolor/512x512/apps/<身份>.png
#
# 图标只装 512x512：那是 hicolor 声明过的最大尺寸（index.theme 的 Directories= 列到 512），
# 更小的尺寸交给图标主题按需缩放 —— 落进**没被声明**的尺寸目录会静默查不到（踩过）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"

fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m·\033[0m %s\n' "$*"; }
good() { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

[ "$(uname -s)" = "Linux" ] || fail "桌面集成只在 Linux 上有意义（当前 $(uname -s)）"

# ── 身份与文案：都从既有事实源读，避免这里再多一处硬编码（漂移的症状永远是「齿轮」）──

# 身份 = app_id = StartupWMClass = 条目文件名（去 .desktop）= 图标名。
# 与 src/main/index.ts 的 setDesktopName()、electron-builder.yml 的 StartupWMClass 同源，见 AGENTS.md §8.1。
APP_ID="$(node -p "require('$ROOT/package.json').desktopName" | sed -E 's/\.desktop$//')"
[ -n "$APP_ID" ] || fail "package.json 里没有 desktopName"

PRODUCT_NAME="$(sed -n 's/^productName:[[:space:]]*//p' "$ROOT/electron-builder.yml" | head -1)"
COMMENT="$(sed -n 's/^[[:space:]]*synopsis:[[:space:]]*//p' "$ROOT/electron-builder.yml" | head -1)"
[ -n "$PRODUCT_NAME" ] || fail "electron-builder.yml 里读不到 productName"
[ -n "$COMMENT" ] || fail "electron-builder.yml 里读不到 synopsis"

DESKTOP_FILE="$DATA_HOME/applications/$APP_ID.desktop"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
ICON_FILE="$ICON_DIR/$APP_ID.png"
ICON_SRC="$ROOT/build/icons/512x512.png"
MARKER='X-Songloft-Managed=true'

# freedesktop 的 Exec 按 shell 风格分词：含空格 / 保留字符的参数必须双引号包起来。
# 这里一律加引号（对不含空格的参数也合法），省掉「什么时候需要引号」的判断；
# 字段码 %U 例外 —— 加了引号启动器就当字面量，不再展开。
exec_quote() { printf '"%s"' "$(printf '%s' "$1" | sed 's/[\\"]/\\&/g')"; }

do_install() { # 参数 = 启动目标的 argv（不含 %U）
  local launch=("$@") arg exec_line=''

  [ -f "$ICON_SRC" ] || fail "找不到 $ICON_SRC —— 先跑 pnpm run icons"
  for arg in "${launch[@]}"; do
    exec_line+="$(exec_quote "$arg") "
  done
  exec_line="${exec_line% } %U"

  # 条目已存在但不是本脚本生成的：不覆盖。用户手工放的那份可能自己维护了 Exec / 图标。
  if [ -e "$DESKTOP_FILE" ] && ! grep -q "^$MARKER" "$DESKTOP_FILE"; then
    fail "$DESKTOP_FILE 已存在且没有 $MARKER 标记（不是本脚本写的）。
    脚本不会覆盖你手工维护的条目，请先自行备份 / 删除它。"
  fi

  mkdir -p "$(dirname "$DESKTOP_FILE")" "$ICON_DIR"
  cat >"$DESKTOP_FILE" <<EOF
# 由 scripts/desktop-integration.sh 生成（$MARKER）：手改会被下次 install 覆盖，卸载用 uninstall。
[Desktop Entry]
Type=Application
Version=1.0
Name=$PRODUCT_NAME
Comment=$COMMENT
Exec=$exec_line
Icon=$APP_ID
Terminal=false
Categories=AudioVideo;Audio;Player;
Keywords=music;player;songloft;audio;
StartupWMClass=$APP_ID
$MARKER
EOF
  cp -f "$ICON_SRC" "$ICON_FILE"

  good "条目 $DESKTOP_FILE"
  good "图标 $ICON_FILE"
  info "GNOME 会在下一个窗口出现时按它取图标；已经在跑的实例重启一下即可看到。"
  info "卸载：bash scripts/desktop-integration.sh uninstall"
}

do_uninstall() {
  if [ -e "$DESKTOP_FILE" ]; then
    if grep -q "^$MARKER" "$DESKTOP_FILE"; then
      rm -f "$DESKTOP_FILE"
      good "已删除 $DESKTOP_FILE"
    else
      warn "保留 $DESKTOP_FILE：它没有 $MARKER 标记，不是本脚本生成的"
    fi
  else
    info "没有 $DESKTOP_FILE，跳过"
  fi

  if [ -e "$ICON_FILE" ]; then
    rm -f "$ICON_FILE"
    good "已删除 $ICON_FILE"
  else
    info "没有 $ICON_FILE，跳过"
  fi
}

case "${1:-}" in
  install)
    shift
    if [ "$#" -gt 0 ]; then
      TARGET="$(readlink -f "$1")"
      [ -f "$TARGET" ] || fail "找不到文件：$1"
      info "Exec 指向：$TARGET"
      do_install "$TARGET"
    else
      ELECTRON="$ROOT/node_modules/electron/dist/electron"
      [ -x "$ELECTRON" ] || fail "找不到 $ELECTRON —— 先跑 pnpm install"
      info "Exec 指向开发态：$ELECTRON + $ROOT"
      do_install "$ELECTRON" "$ROOT"
    fi
    ;;
  uninstall)
    do_uninstall
    ;;
  *)
    usage
    exit 1
    ;;
esac
