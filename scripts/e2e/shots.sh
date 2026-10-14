#!/usr/bin/env bash
#
# 把巡检截图整理成**文档要用的两张东西**（先跑 `pnpm run e2e` 产出 `.e2e/shots`）：
#
#   1. docs/e2e-walkthrough.png —— 全部步骤的覆盖图：一格一步、带步骤名。
#      每格很小（看不清字），它存在的意义是**一屏看完整片森林** ——
#      「哪一格是空的 / 白了 / 弹窗没关掉」这种问题在这张图上一眼就抓得到，
#      而逐个点开 74 张 png 是没人会做的事。
#   2. docs/screenshots/*.png   —— 主要界面的单张图，留给 README 嵌。
#      这些是**看得清**的（1440 宽折到 1080），所以不与覆盖图重复职责。
#
# 两个产物都由这个脚本生成、且都可以重新生成：截图一旦变成「手工裁的」，下次改界面
# 就没人愿意重做了 —— 文档里的图会安静地过期。
#
# 说明：这里用 ImageMagick 合成的是 **png**（不是 svg），不涉及 AGENTS.md §8.5 里
# 「渲 SVG 会静默丢渐变」那个坑；但仍然在最后校验一次产物不是全灰。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SHOTS="$ROOT/.e2e/shots"
DOCS="$ROOT/docs"
OUT_DIR="$DOCS/screenshots"
WALKTHROUGH="$DOCS/e2e-walkthrough.png"

command -v magick >/dev/null || {
  echo "需要 ImageMagick 7（magick），见 README 的依赖说明" >&2
  exit 1
}

if [ ! -d "$SHOTS" ] || [ -z "$(ls -A "$SHOTS" 2>/dev/null)" ]; then
  echo "没有找到截图：先跑 pnpm run e2e（产物在 $SHOTS）" >&2
  exit 1
fi

count="$(find "$SHOTS" -name '*.png' | wc -l)"
echo "==> 从 $count 张巡检截图生成文档用图"

# ── 主要界面：挑出有代表性的那几步，换成能看懂的短名字 ──────────────────────
# 键是巡检里的步骤名（前缀匹配），值是文档里那份的名字；
# 可选的第三段是缩放方式（默认折到 1080 宽）。
# 改界面后步骤可能挪动，所以这里用**名字**而不是序号找 —— 序号会漂，名字不会。
#
# ★ 迷你窗那一张要单独说：它是**另一个窗口**（另一张 CDP 截图），只有 400px 宽 ——
#   按默认那档折到 1080 是从 400 放上去，字会糊成一片。整倍放大（2x）配最近邻采样
#   出来的是「像素大一点的同一张图」，比插值出来的灰边清楚得多。
PICKS=(
  'home:home'
  'library:library'
  'library-folders-tab:library-folders'
  'playlists:playlists'
  'playlist-detail:playlist-detail'
  'search-results:search'
  'song-menu:song-context-menu'
  'select-two:multi-select'
  'settings-appearance:settings-appearance'
  'extensions-store:extensions-store'
  'extensions-manage:extensions-manage'
  'fullplayer-open:full-player'
  'mini-lyrics:mini-player:2x'
  'logout:login'
  'login-failed:login-error'
)

mkdir -p "$OUT_DIR"
# 先清掉上一轮的产物：界面删掉/改名后，旧图不该继续留在文档目录里
find "$OUT_DIR" -maxdepth 1 -name '*.png' -delete

for pick in "${PICKS[@]}"; do
  step="${pick%%:*}"
  rest="${pick#*:}"
  name="${rest%%:*}"
  # 第三段可省：省略时 ${rest##*:} 就是 name 本身，于是走默认那档缩放
  scale="${rest##*:}"
  # 步骤名形如 `43-extensions-store`，用尾部通配匹配
  src="$(find "$SHOTS" -maxdepth 1 -name "*-$step.png" | head -1)"
  if [ -z "$src" ]; then
    echo "    跳过 $name：没找到步骤 *-$step.png（巡检步骤改名了？）" >&2
    continue
  fi
  if [ "$scale" = '2x' ]; then
    magick "$src" -filter point -resize 200% -strip -depth 8 "$OUT_DIR/$name.png"
  else
    magick "$src" -resize 1080x -strip -depth 8 "$OUT_DIR/$name.png"
  fi
  echo "    $name.png  ←  $(basename "$src")"
done

# ── 覆盖图：一格一步，6 列，带步骤名 ────────────────────────────────────────
# 缩到 320 宽：再大就排不进一张图，再小就分不出是哪一页；分辨「页面」与「空白」够用。
#
# ★ `-depth 8` 不是可选项：montage 的输出位深跟着**输入**走，只要有一张是 16 位，
#   整张覆盖图就变 16 位 —— 同样的内容从 0.5 MB 涨到 4.7 MB，而看图时看不出差别。
#   （想让体积再小一截可以量化调色板，但 `-colors` 在 montage 里是按**每一格**生效的，
#   加在那条命令上只会把图变大 —— 要量化得另起一趟 magick。）
magick montage \
  -label '%t' \
  "$SHOTS"/*.png \
  -tile 6x \
  -geometry 320x205+8+8 \
  -background '#0e1015' \
  -fill '#c9cdd8' \
  -pointsize 12 \
  -strip \
  -depth 8 \
  "$WALKTHROUGH"

# ── 自检：产物得是真图，而且不是「一片黑」 ──────────────────────────────────
# 覆盖图最容易的坏法是 montage 悄悄只剩一张（路径没展开）或整张全黑，
# 这两种都不报错。所以这里断言尺寸与颜色数。
walk_info="$(magick identify -format '%wx%h %k' "$WALKTHROUGH")"
echo "==> $WALKTHROUGH ($walk_info)"

walk_colors="${walk_info##* }"
if [ "${walk_colors:-0}" -lt 64 ]; then
  echo "覆盖图颜色数只有 $walk_colors —— 大概是渲染坏了（或整张全黑）" >&2
  exit 1
fi

picked="$(find "$OUT_DIR" -maxdepth 1 -name '*.png' | wc -l)"
echo "==> $OUT_DIR 下 $picked 张主要界面图"
