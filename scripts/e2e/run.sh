#!/usr/bin/env bash
#
# 端到端 UI 巡检：mock 后端 → 构建产物启动 Electron → CDP 驱动 → 逐界面截图 + 断言。
#
#   pnpm run e2e              # 先 build，再跑完整巡检
#   pnpm run e2e -- --keep    # 保留 .e2e/ 里的截图与日志（默认也保留，方便查看）
#
# ───────────────────────────── 三个必须知道的坑 ─────────────────────────────
#
# 1. **mock 必须和 Electron 在同一次调用里起。**
#    某些 agent/CI 的 shell 会在命令结束时回收它启动的后台进程；分开起会得到一个
#    "没有后端"的假结论（渲染层 fetch 报 ERR_CONNECTION_REFUSED，看着像应用有问题）。
#
# 2. **`ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化成纯 Node。**
#    宿主环境会导出这个变量，症状是主进程一启动就 `electron.app === undefined`、
#    调 setDesktopName 直接抛错退出。这里显式剥掉它和 NODE_OPTIONS。
#
# 3. **不要用 `import -window root` 截图。**
#    那是 X11 截屏：在有 Wayland 会话时会被 Wayland 接管、得到一张空白图；
#    截图一律走 CDP 的 Page.captureScreenshot（拿的是渲染层内容，与显示服务器无关）。
#
# 断言为什么必须存在：mock 的 lyric 有 10 行、lxlyric 只覆盖其中 4 行 —— 这是
# 「逐字源覆盖不全时主歌词被整行丢掉」的复现条件。没有断言时这类**静默**缺陷
# 只能靠肉眼看截图。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_DIR="$ROOT/scripts/e2e"
OUT_DIR="${E2E_OUT_DIR:-$ROOT/.e2e}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"

USER_DATA="$OUT_DIR/userdata"
SHOTS="$OUT_DIR/shots"
MOCK_LOG="$OUT_DIR/mock.log"
APP_LOG="$OUT_DIR/app.log"
CDP_PORT="${CDP_PORT:-9222}"

if [ -z "$NODE_BIN" ]; then
  echo "✗ 找不到 node，请设置 NODE_BIN" >&2
  exit 1
fi
if [ ! -f "$ROOT/out/renderer/index.html" ]; then
  echo "✗ 缺少构建产物 out/renderer/index.html —— 先跑 pnpm run build" >&2
  exit 1
fi
if [ ! -x "$ROOT/node_modules/electron/dist/electron" ]; then
  echo "✗ 找不到 electron 二进制 —— 先跑 pnpm install" >&2
  exit 1
fi

# 驱动器先做语法检查。脚本里的模板字符串一旦被反引号提前闭合，要等应用起来、
# 连上 CDP 之后才报 SyntaxError —— 白白浪费一整轮 70 秒。
if ! "$NODE_BIN" --check "$E2E_DIR/drive.mjs"; then
  echo "✗ drive.mjs 语法错误，先修脚本" >&2
  exit 1
fi

# ── 临时目录必须放得下 Chromium 的共享内存 / 字体数据 ────────────────────────
# 本机 /tmp 是 **10MB 的 tmpfs**。空间不够时 Chromium 先警告
#   "Less than 64MB of free space in temporary directory for shared memory files"
# 然后在字体服务里直接 FATAL "设备上没有空间" 并 core dump —— 表现为「巡检跑到一半崩掉」，
# 而不是一句"磁盘空间不足"。所以低于阈值就退到项目内的 .tmp/（已 gitignore）。
TMP_AVAIL_KB="$(df -Pk "${TMPDIR:-/tmp}" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$TMP_AVAIL_KB" ] && [ "$TMP_AVAIL_KB" -lt 262144 ]; then
  export TMPDIR="$ROOT/.tmp"
  mkdir -p "$TMPDIR"
  echo "! 临时目录可用仅 $((TMP_AVAIL_KB / 1024))MB，改用项目内 $TMPDIR（Chromium 需要共享内存/字体临时文件）"
fi

rm -rf "$OUT_DIR"
mkdir -p "$USER_DATA" "$SHOTS"
cp "$E2E_DIR/fixtures/config.json" "$USER_DATA/config.json"

# ── 1. mock 后端 ────────────────────────────────────────────────────────────
"$NODE_BIN" "$E2E_DIR/server.mjs" >"$MOCK_LOG" 2>&1 &
MOCK_PID=$!

for _ in $(seq 1 40); do
  curl -sf -m 1 "http://127.0.0.1:58091/api/v1/version" >/dev/null 2>&1 && break
  sleep 0.25
done
if ! curl -sf -m 2 "http://127.0.0.1:58091/api/v1/version" >/dev/null; then
  echo "✗ mock 后端没起来，看 $MOCK_LOG" >&2
  kill "$MOCK_PID" 2>/dev/null
  exit 1
fi
echo "✓ mock 后端就绪 $(curl -s http://127.0.0.1:58091/api/v1/songs/stats)"

# ── 2. 应用 ────────────────────────────────────────────────────────────────
cd "$ROOT" || exit 1

ELECTRON_ARGS=(
  . --no-sandbox --disable-gpu --disable-dev-shm-usage
  "--remote-debugging-port=$CDP_PORT"
  --enable-logging=stderr --v=0
)

if command -v xvfb-run >/dev/null 2>&1; then
  # 用虚拟显示而不是用户的真实会话：巡检不该抢焦点、闪窗口、动到真实 userData。
  # -u WAYLAND_DISPLAY -u XAUTHORITY：不剥掉的话会连回真实会话，Xvfb 白起。
  env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS -u WAYLAND_DISPLAY -u XAUTHORITY \
      SONGLOFT_USER_DATA="$USER_DATA" TMPDIR="${TMPDIR:-/tmp}" \
      xvfb-run -a --server-args="-screen 0 1680x1050x24 -ac" \
      ./node_modules/electron/dist/electron "${ELECTRON_ARGS[@]}" --ozone-platform=x11 >"$APP_LOG" 2>&1 &
  APP_PID=$!
else
  echo "! 没有 xvfb-run，直接用当前显示（可能会闪窗口）" >&2
  env -u ELECTRON_RUN_AS_NODE -u NODE_OPTIONS \
      SONGLOFT_USER_DATA="$USER_DATA" \
      ./node_modules/electron/dist/electron "${ELECTRON_ARGS[@]}" >"$APP_LOG" 2>&1 &
  APP_PID=$!
fi

cleanup() {
  kill "$APP_PID" 2>/dev/null
  sleep 1
  kill -9 "$APP_PID" 2>/dev/null
  kill "$MOCK_PID" 2>/dev/null
}
trap cleanup EXIT

CDP_PORT="$CDP_PORT" SHOT_DIR="$SHOTS" "$NODE_BIN" "$E2E_DIR/drive.mjs"
DRIVE_RC=$?

echo "=== mock：未实现的端点 ==="
grep '未命中' "$MOCK_LOG" | sort -u | sed 's/^/  /' || echo "  （无，全部端点已覆盖）"

echo "=== 主进程日志（滤掉噪声）==="
grep -vE 'wayland_object|wayland_surface|ozone_platform|xdg/portal|StatusNotifier|dbus/exported_object|object_proxy|Electron Security Warning|DevTools listening|^$|^destination:|^path:|^interface:|^member:|^sender:|^serial:|^signature:|^string |policy with|Policy set|For more information|once the app is packaged|this app to unnecessary|^This warning|electronjs.org' \
  "$APP_LOG" | tail -20

echo "=== 截图：$SHOTS ==="
ls "$SHOTS" | sed 's/^/  /'

exit $DRIVE_RC
