#!/bin/bash
# generate-changelog.sh —— 从提交历史生成 Release 的发布说明。
#
# 由 `.github/workflows/release.yml` 调用，产物（默认 release-notes.md）交给
# `gh release create/edit --notes-file` 写入 Release body。
#
# 刻意**不**经过 electron-builder 的 `releaseInfo.releaseNotesFile`：显式点名一个不存在的
# 资源时它会**抛错**而不是跳过，而读取它的步骤属于"每次构建都会跑到"的那一类 —— 于是
# 本地 `pnpm run pack:linux` 也会跟着失败。显式写入 Release 与构建路径无关。
#
# 用法:
#   ./generate-changelog.sh <当前标签> [前一个标签] [输出文件]
#
#   <当前标签>    必填，如 v0.2.0
#   [前一个标签]  由 release.yml 用 get-tags.sh 算好后传入（那边的规则更细：X.Y.0 要跨
#                 整个上一个 minor 系列、预发布标签要剔除）；省略时本脚本用 git describe
#                 简单推断，只为本地手动运行时也能出结果
#   [输出文件]    默认 release-notes.md
#
# 环境变量:
#   GITHUB_REPOSITORY     有则用它拼对比链接，否则从 git remote 推断
#   GITHUB_STEP_SUMMARY   设置了就一并写进 Actions 的步骤摘要
#   GITHUB_OUTPUT         设置了就输出 notes_file（供工作流后续步骤引用）
#
# 为什么按"提交前缀"分类、而不调用 GitHub API 生成：发布路径上少一个网络依赖，也就少一个
# 会限流、会失败的环节。分类只认约定式提交里用户可见的那几种类型，且类型必须在**行首**。
set -eu

if [ $# -lt 1 ] || [ $# -gt 3 ]; then
  echo "用法: $0 <当前标签> [前一个标签] [输出文件]" >&2
  exit 1
fi

current_tag="$1"
previous_tag="${2:-}"
output_file="${3:-release-notes.md}"

# 拼对比链接用的仓库地址。取不到只会让链接缺一段，不该让发布失败。
repo_slug="${GITHUB_REPOSITORY:-}"
if [ -z "$repo_slug" ]; then
  # 两步剥壳（先前缀、再 .git 后缀）而不是一条带可选组的正则：
  #   `[^/]+?`(惰性) 在 POSIX ERE 里不是标准语法，GNU sed 会把它当贪婪处理，
  #   于是 `…/repo.git` 会整个吃进 owner/repo 里、`.git` 留在结果中（实测踩过）。
  #   `s#…#…#; s#…#…#' 这种"锚定末尾"的写法没有歧义。
  repo_slug=$(git config --get remote.origin.url 2>/dev/null \
    | sed -E 's#^.*github\.com[:/]##; s#\.git$##' || true)
  # ★ sed 在**不匹配**时会把原串原样还回来（例如 remote 是本地路径），所以必须再验一次形状：
  #   否则后面拼出来的是一个"看起来像链接"的错误 URL，而不是一句警告。
  if ! [[ "$repo_slug" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]]; then
    repo_slug=""
  fi
fi
if [ -z "$repo_slug" ]; then
  echo "⚠️ 推断不出 GitHub 仓库地址（GITHUB_REPOSITORY 为空，git remote 也不是 GitHub 地址）：发布说明里不会带对比链接" >&2
fi

# 当前标签必须存在：不然下面的 `git log` 会以"未知修订"失败，报错信息指不到根因。
if ! git rev-parse -q --verify "refs/tags/$current_tag" >/dev/null; then
  echo "❌ 标签 $current_tag 在本地不存在。浅克隆或未拉取标签时先 git fetch --tags。" >&2
  exit 1
fi

# 省略前一个标签时自动推断 —— 这条路径是给**本地手动运行**兜底的：CI 里 release.yml 会先用
# get-tags.sh（--minor 模式）算好再传进来，那套规则比下面这条复杂得多，冲突时以它为准。
#   `标签^` 从**父提交**往回找，避免把当前标签自己当成"上一个"；
#   `--match 'v*'` 只认版本标签，忽略里程碑之类。
if [ -z "$previous_tag" ]; then
  previous_tag=$(git describe --tags --abbrev=0 --match 'v*' "${current_tag}^" 2>/dev/null || true)
fi

# 显式传入的前一个标签必须真实存在于本地：浅克隆或标签被重命名时 `git log` 会直接失败，
# 把整个发布卡住 —— 而这只需退回"全量历史"就能继续。
if [ -n "$previous_tag" ] && ! git rev-parse -q --verify "refs/tags/$previous_tag" >/dev/null; then
  echo "⚠️ 标签 $previous_tag 在本地不存在，退回全量历史" >&2
  previous_tag=""
fi

if [ -z "$previous_tag" ]; then
  commit_range="$current_tag"
  echo "ℹ️ 没有可用的前一个版本标签：$current_tag 的全部历史都会进发布说明"
else
  commit_range="$previous_tag..$current_tag"
  echo "ℹ️ 对比范围：$commit_range"
fi

# 类型必须在行首：用 `*feat*` 这类通配去匹配整行时，"fix the feature list" 会同时出现在
# 新功能与缺陷修复两节里；`chore(release): v0.2.0` 这类机械提交也不该出现在自己版本的说明里。
commit_type_re='^(feat|fix|perf|refactor|docs)(\([^)]*\))?!?:'

sections_dir=$(mktemp -d)
trap 'rm -rf "$sections_dir"' EXIT

while IFS=$'\t' read -r subject author_name short_sha; do
  [ -n "$subject" ] || continue

  if [[ "$subject" =~ $commit_type_re ]]; then
    type="${BASH_REMATCH[1]}"
  else
    continue
  fi

  # 反引号转义：标题里落单的反引号会把其后整段 Markdown 一起吃掉
  printf '%s\n' "- ${subject//\`/\\\`} - by $author_name ($short_sha)" >> "$sections_dir/$type"
done <<< "$(git log --pretty=format:"%s%x09%an%x09%h" "$commit_range")"

notes=""
has_sections=false

append_section() {
  local section_file="$1" section_title="$2"
  if [ -s "$section_file" ]; then
    notes="${notes}### ${section_title}"$'\n\n'
    notes="${notes}$(cat "$section_file")"$'\n\n'
    has_sections=true
  fi
}

append_section "$sections_dir/feat" '🚀 新功能'
append_section "$sections_dir/fix" '🩹 缺陷修复'
append_section "$sections_dir/perf" '🔥 性能优化'
append_section "$sections_dir/refactor" '🔨 代码重构'
append_section "$sections_dir/docs" '📖 文档'

# 全是 chore / ci / test 一类提交时也要给出说明，而不是让 Release 页面只有一堆产物
if [ "$has_sections" = false ]; then
  notes="本版本没有可归类的用户可见改动（提交历史里没有 \`feat\` / \`fix\` / \`perf\` / \`refactor\` / \`docs\` 前缀的提交）。"$'\n'
fi

notes="${notes}"$'\n'"---"$'\n\n'

if [ -n "$previous_tag" ]; then
  range_label="${previous_tag}...${current_tag}"
  range_url="compare/${previous_tag}...${current_tag}"
else
  range_label="${current_tag} 的全部提交"
  range_url="commits/${current_tag}"
fi

if [ -n "$repo_slug" ]; then
  notes="${notes}**完整变更**：[\`${range_label}\`](https://github.com/${repo_slug}/${range_url})"$'\n'
else
  # 没有仓库地址时宁可只给文字范围，也不要拼出 https://github.com//... 这种无效链接
  notes="${notes}**完整变更**：\`${range_label}\`"$'\n'
fi

printf '%s\n' "$notes" > "$output_file"
echo "📝 发布说明已写入 $output_file："
cat "$output_file"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '%s\n' "$notes" >> "$GITHUB_STEP_SUMMARY"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "notes_file=$output_file" >> "$GITHUB_OUTPUT"
fi
