/**
 * 用例装载。
 *
 * ## 用 `import.meta.glob` 而不是九行 `import`
 *
 * 两种写法都能跑。差别在于**加一个用例文件要不要改代码**：
 * 逐个 `import` 的写法里，忘掉一行就等于那个文件永远不会被执行 ——
 * 而它的表现是「评测集全绿」，没有别的症状。glob 把「新增文件 ⇒ 自动纳入」
 * 变成结构性事实。
 *
 * ## 路径是相对 import，不是 `@applypack/core`
 *
 * 正常情况下这里该写 `import … from '@applypack/core'`，而那需要 pnpm 在
 * 本机为 workspace 包创建符号链接。**本仓库路径下建不了符号链接**
 * （实测记录见 `pnpm-workspace.yaml`，关掉沙箱也一样），所以走相对路径。
 *
 * 这不是权宜之计：`@applypack/core` 的 `exports` 里 `"."` 指向的正是
 * `./src/index.ts`，符号链接也只是把同一个文件换个名字暴露出来。
 * 相对路径解析到的是**同一个文件**，只是少了一层链接。
 */

import { collectCases } from './schema'

const RAW = import.meta.glob('../cases/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>

/** 按文件名排序后再汇总 —— 报告里的顺序因此只取决于文件名，不取决于文件系统。 */
export const COLLECTED = collectCases(
  Object.entries(RAW)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([origin, data]) => ({ origin, data })),
)

export const EVAL_CASES = COLLECTED.cases
