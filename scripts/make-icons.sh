#!/usr/bin/env bash
# 生成本项目要用的位图图标。
#
# 事实源有两份，别搞混：
#   build/icon.svg        矢量母版（= songloft-player/web/favicon.svg）
#   build/icon-source.png 位图母版（= songloft-player/assets/icons/app_icon.png，1024×1024 官方图）
#
# 为什么不能只靠 ImageMagick：它的内置 SVG 解析器**丢掉渐变与描边**（实测把这张图渲成
# 黑白波形），而退出码是 0 —— 典型的静默失败。所以这里的渲染器优先级是
#   rsvg-convert → inkscape → 无头 Chromium/Chrome → （拒绝）ImageMagick
# 且无论走哪条路，产物都要过一遍「色相族覆盖」断言（见 assert_icon），黑白图当场失败。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVG="$ROOT/build/icon.svg"
PNG="$ROOT/build/icon-source.png"
OUT="$ROOT/build/icons"

fail() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
info() { printf '\033[36m·\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }

# ── 断言：图里必须同时出现 青/蓝、紫、橙红 三族色相 ────────────────────────────
# 这张图是 青(#06B6D4)→紫(#8B5CF6) 渐变 + 橙红(#F59E0B→#EF4444) 音符。
# 渲染器一旦丢渐变/描边，色相族数就会塌到 0~1 —— 这正是「颜色数 ≥ 16」那种弱断言
# 抓不到的（黑白抗锯齿图照样有几十个灰阶「颜色」）。
assert_icon() {
  local png="$1" need="${2:-3}"
  [ -f "$png" ] || return 1

  local dim w
  dim="$(magick identify -format '%wx%h' "$png" 2>/dev/null)" || return 1
  w="${dim%x*}"
  [ "$w" -ge 256 ] || return 1

  local families
  families="$(magick "$png" -background none -flatten -resize 128x128 -colors 24 -format '%c' histogram:info:- 2>/dev/null \
    | node "$ROOT/scripts/icon-hue-buckets.mjs")" || return 1
  [ "${families:-0}" -ge "$need" ] || return 1

  info "$(basename "$png") ${dim}，色相族 ${families} ✓"
}

# ── 渲染器：矢量优先（精确 + 快），其次无头浏览器（与打包产物同源）──────────────
find_renderer() {
  for r in rsvg-convert inkscape chromium chromium-browser google-chrome google-chrome-stable; do
    command -v "$r" >/dev/null 2>&1 && { echo "$r"; return; }
  done
}

render_vector() { # $1=renderer $2=out $3=size
  case "$1" in
    rsvg-convert) rsvg-convert -w "$3" -h "$3" -o "$2" "$SVG" ;;
    inkscape) inkscape "$SVG" --export-type=png --export-filename="$2" -w "$3" -h "$3" >/dev/null 2>&1 ;;
  esac
}

render_browser() { # $1=browser $2=out $3=size
  # ★ 不能直接对 .svg 截图：SVG 自带 width/height=512，浏览器只会画在视口左上角，
  #   剩下全是空白 —— 缩到 128px 后色相被白底稀释，断言会莫名其妙地失败（实测踩过）。
  #   必须套一层 100% 铺满的 HTML 壳，并显式要求透明背景。
  local tmp; tmp="$(mktemp -d)"
  {
    printf '<!doctype html><meta charset="utf-8"><style>'
    printf 'html,body{margin:0;padding:0;width:100%%;height:100%%;background:transparent;overflow:hidden}'
    printf 'svg{display:block;width:100%%;height:100%%}'
    printf '</style>'
    cat "$SVG"
  } > "$tmp/wrap.html"

  "$1" --headless --disable-gpu --no-sandbox --hide-scrollbars --force-device-scale-factor=1 \
       --user-data-dir="$tmp/profile" --default-background-color=00000000 \
       --virtual-time-budget=4000 --window-size="$3,$3" \
       --screenshot="$2" "file://$tmp/wrap.html" >/dev/null 2>&1 || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
}

RENDERER="$(find_renderer || true)"
STAGED="$(mktemp -u /tmp/songloft-icon-XXXXXX.png)"

rendered=0
if [ -n "$RENDERER" ]; then
  info "渲染器：$RENDERER，从 icon.svg 重渲位图母版"
  case "$RENDERER" in
    rsvg-convert|inkscape) render_vector "$RENDERER" "$STAGED" 1024 && rendered=1 ;;
    *) render_browser "$RENDERER" "$STAGED" 1024 && rendered=1 ;;
  esac
else
  warn "没有可用渲染器（rsvg-convert / inkscape / 无头 Chromium 都没有）"
fi

if [ "$rendered" = 1 ] && assert_icon "$STAGED" 3; then
  mv -f "$STAGED" "$PNG"
elif [ -f "$PNG" ] && assert_icon "$PNG" 3; then
  [ "$rendered" = 1 ] && warn "新渲染的图没通过断言（已丢弃），沿用仓库里已核对的位图母版"
  info "沿用已核对的位图母版 $PNG"
else
  rm -f "$STAGED"
  fail "拿不到一张可信的图标。
    装一个正经渲染器：sudo apt install librsvg2-bin
    或从 https://github.com/songloft-org/songloft-player 取 assets/icons/app_icon.png 放到 build/icon-source.png。"
fi

# ── 派生尺寸（electron-builder 只吃 build/icon-source.png 这一份）──────────────
mkdir -p "$OUT"
for size in 16 32 48 64 128 256 512; do
  magick "$PNG" -resize "${size}x${size}" -strip "$OUT/${size}x${size}.png"
done
info "派生尺寸写入 build/icons/（16…512）"

# ── 负向自检：故意喂一张灰度图，断言必须失败（只会输出 ✓ 的校验等于没有校验）────
magick "$PNG" -colorspace Gray -colorspace sRGB "$OUT/.negative-control.png"
if assert_icon "$OUT/.negative-control.png" 3 >/dev/null 2>&1; then
  rm -f "$OUT/.negative-control.png"
  fail "自检失败：灰度图竟然通过了色相断言，说明 assert_icon 是失效的。"
fi
rm -f "$OUT/.negative-control.png"
info "负向自检通过（灰度图被正确拦下）"
