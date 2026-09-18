/**
 * A / B 数据分级的类型层。
 *
 * 分界线的判据不是「敏感 / 不敏感」，而是**模型是否需要知道**：
 *
 * - **A 级 · 能力与经历叙事** ——「你会什么」。模型必须读到才能改写，允许组进模型请求。
 * - **B 级 · 身份与联系标识** ——「你是谁」。模型写一条 bullet 时完全不需要它，
 *   产出物里的这部分内容由**确定性代码注入**，绝不经过模型。
 *
 * 这条判据解释了一个容易困惑的地方：手机号明明要印在简历上，为什么是 B 级？
 * 因为「上简历」和「进模型请求」是两件事 —— B 级管的是后者。
 *
 * @see DESIGN.md 1.3 · AGENTS.md §5 红线 1 / 2 / 6
 */

export type DataLevel = 'A' | 'B'

export interface FieldPolicy {
  /** 档案中的字段路径，如 `basics.contact`；是叶子路径的前缀 */
  readonly path: string
  readonly level: DataLevel
  /** 恒等于 `level === 'B'`，冗余存储只为让断言读起来不需要二次推导 */
  readonly neverSendToLLM: boolean
}

export function fieldPolicy(path: string, level: DataLevel): FieldPolicy {
  return { path, level, neverSendToLLM: level === 'B' }
}

/**
 * 分级声明的形状约束 —— 这里承担的是**编译期**的完整性保证。
 *
 * 对一个对象类型的字段，声明时有两种写法：
 *   1. 直接给一个级别字符串：整个子树共用该级别（用于级别统一的子树，如 `work`、`basics.contact`）
 *   2. 给一个嵌套声明对象：子树的每个键都必须被声明（用于级别混合的子树，如 `basics`）
 *
 * 因为 `satisfies` 会检查缺键与多键，**任何新增字段如果没被声明级别，typecheck 就会失败**。
 * 也就是说「漏标字段」这件事在编译期就不可能发生，不需要靠测试去补。
 * 测试负责的是另一件事：策略表里的路径名有没有拼错（见 policy.test.ts 的双向覆盖用例）。
 */
export type LevelSpec<T> = [T] extends [readonly unknown[]]
  ? DataLevel
  : [T] extends [object]
    ? { [K in keyof T]-?: LevelSpec<T[K]> | DataLevel }
    : DataLevel

/**
 * 把声明式的分级表摊平成字段策略列表。
 * 只认两种节点：字符串 = 叶子（整棵子树共用一个级别），对象 = 继续拆分。
 */
export function collectFieldPolicies(spec: unknown, prefix = ''): readonly FieldPolicy[] {
  if (typeof spec === 'string') {
    if (prefix === '') return []
    if (spec !== 'A' && spec !== 'B') {
      throw new TypeError(`字段 ${prefix} 的级别声明非法：${spec}`)
    }
    return [fieldPolicy(prefix, spec)]
  }
  if (spec === null || typeof spec !== 'object') return []

  const collected: FieldPolicy[] = []
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    collected.push(...collectFieldPolicies(value, prefix === '' ? key : `${prefix}.${key}`))
  }
  return collected
}
