import { defineConfig } from 'bumpp'

/**
 * 发版配置。`pnpm run release` → [bumpp](https://github.com/antfu-collective/bumpp)。
 *
 * 一次发版 = 提升 `package.json` 的版本 → 提交 → 打 `v<版本>` 标签 → 推送。
 * 标签推上去就触发 `.github/workflows/release.yml`：三平台（Linux / Windows / macOS）
 * 各自构建，**全部成功之后**才创建 Release 并上传产物。
 *
 * 也就是说：本地这条命令只管「版本号与标签对齐」这一件最容易出错的事，构建与发布都在 CI。
 * 完整链路：
 *
 *   pnpm run release --release minor          # ① 本地：升版本 + 提交 + 打 v0.2.0 标签 + 推送
 *     └─ push tag v0.2.0
 *          ├─ preflight   校验「标签 ↔ package.json 版本」一致，跑 check
 *          ├─ build       三平台并行构建（各自 --publish never，产物只落在 release/）
 *          └─ release     汇总断言齐全 → 创建 Release → 上传 → 再断言资产齐全
 *
 * ⚠️ **不要**写成 `pnpm run release -- --release minor`（npm 时代的习惯）。本仓库钉死的
 *   pnpm 会把 `--` 原样转发给脚本：参数落到 bumpp 的位置参数（文件名）上，于是版本参数
 *   不生效、弹出交互式选择器，最后还会去 bump 一个叫 `--release` 的文件。
 *   裸参数直接跟在脚本名后面即可。
 *
 * ⚠️ 发布不可回退：产物一旦发布，删掉 Release 也收不回已经散出去的校验值与下载链接。
 *   所以版本与标签必须在推送前就一致 —— release.yml 的第一件事就是校验这一点。
 */
export default defineConfig({
  /**
   * 只碰 `package.json`。
   *
   * ⚠️ 绝不能把 CHANGELOG 之类的文件加进来：bumpp 对「已知文件」之外的路径做的是旧版本号的
   * **全文替换**，会连带改写历史小节标题与对比链接，而且不会报错 —— 属于事后才发现的一类损坏。
   */
  files: ['package.json'],

  /**
   * 要求工作区干净（bumpp 默认不做这项检查，命令行上对应 `--git-check`）。
   *
   * 理由：发布提交里应当只有「版本号」这一处改动。带着未提交的东西发版，标签指向的内容
   * 与发布者以为的不一致，而这件事要等产物发出去之后才会被发现。
   *
   * ⚠️ 与 `all` 的耦合：bumpp 在 `all: true` 时会**跳过**这项检查（它要的就是把未提交的
   *   改动一并提交），所以不要打开 `all`，否则这条守卫会静默失效。
   */
  noGitCheck: false,

  /**
   * `{tag}` 渲染成标签名 ⇒ `chore(release): v0.2.0`。
   * 用 `{tag}` 而不是再拼一遍 `v{version}`：标签格式只在下面定义一处。
   */
  commit: 'chore(release): {tag}',

  /** ⇒ `v0.2.0`，与 release.yml 的 `on.push.tags: ['v*']` 对齐。 */
  tag: 'v{version}',

  /** 提交与标签一起推：少推任何一个，远端都会与本地分叉，而发布正是靠标签触发的。 */
  push: true
})
