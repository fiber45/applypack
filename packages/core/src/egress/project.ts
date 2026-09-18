/**
 * A 级投影 —— 「三层防空」的第二层（组装层）的第一半。
 *
 * 这个函数是**唯一**允许把档案喂给模型的路径。它的正确性要求只有一条：
 * 返回值里不存在任何 B 级路径的叶子。
 *
 * 实现上刻意用**白名单**（只保留有 A 级策略的子树），而不是黑名单（剔除已知 B 级字段）。
 * 差别在失败模式上：
 *   - 黑名单漏掉一个字段名 ⇒ 该字段静默出网，且没有任何症状；
 *   - 白名单遇到未声明的路径 ⇒ 直接丢弃（保守失败），丢错了是功能缺陷，不是隐私事故。
 * 两者都错了的前提下，后者是唯一可接受的失败方向。
 *
 * @see DESIGN.md 1.3 · AGENTS.md §6
 */

import { aLevelPaths, fieldPolicyFor } from '../schema/index'
import type { ArchiveV1 } from '../schema/index'

/**
 * 所有「是某条 A 级策略的祖先」的路径。
 *
 * 为什么需要它：策略表是**叶子声明**。`basics` 自己没有策略，策略挂在
 * `basics.label` / `basics.name` 等子键上。若只按「当前路径有无策略」判断，
 * `basics` 会被当成未声明字段整棵丢掉 —— 姓名的确没出网（安全），
 * 但标签和简介也没了（功能全废）。所以容器节点必须靠「后代里有没有 A 级」来识别。
 */
const A_PATH_PREFIXES: ReadonlySet<string> = new Set(
  aLevelPaths().flatMap((path) => {
    const segments = path.split('.')
    return segments.map((_, index) => segments.slice(0, index + 1).join('.'))
  }),
)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 深拷贝。必须拷贝而不是引用：投影结果会进入请求对象并被冻结，
 * 若与档案共享引用，后续任何一次 `archive.work[0].highlights.push(...)`
 * 都会同时改写「已发出的请求」—— 一个只会在并发场景下出现的幽灵 bug。
 */
function deepCopy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepCopy)
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) out[key] = deepCopy(item)
    return out
  }
  return value
}

/**
 * 递归投影。
 *
 * 策略解析只有三种结果，且都走向一个明确的分支：
 *   - 命中 A 级 ⇒ 整棵子树保留（策略表里的叶子声明覆盖其下全部实际叶子）
 *   - 命中 B 级 ⇒ 整棵子树丢弃
 *   - **没有策略覆盖 ⇒ 丢弃。** 这是本函数唯一一处「宁可错杀」的地方。
 *     未声明路径意味着它没有级别，因而无法参与任何判定 —— 一个混进来的
 *     `contacts_backup` 就足以绕过整条红线（ADR-8 否决 `.passthrough()` 的同一个理由）。
 */
function projectNode(value: unknown, path: string): { keep: true; value: unknown } | { keep: false } {
  if (path !== '') {
    const policy = fieldPolicyFor(path)
    if (policy?.level === 'B') return { keep: false }
    if (policy?.level === 'A') return { keep: true, value: deepCopy(value) }
    // 自身无策略：只有「后代里存在 A 级策略」的容器才值得下沉。
    // 其余一律丢弃 —— 那才是真正的未声明字段（幽灵字段）。
    if (!A_PATH_PREFIXES.has(path)) return { keep: false }
  }

  // 根节点与需要下沉的容器节点在此汇合。
  if (Array.isArray(value)) {
    const items: unknown[] = []
    for (const item of value) {
      const projected = projectNode(item, path)
      if (projected.keep) items.push(projected.value)
    }
    return { keep: true, value: items }
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`
      const projected = projectNode(item, childPath)
      if (projected.keep) out[key] = projected.value
    }
    return { keep: true, value: out }
  }
  return { keep: false }
}

/**
 * 把一份档案投影成可以出网的 A 级视图。
 *
 * 注意它**读得到** B 级字段（它必须遍历全部键才能丢弃它们），
 * 这与 AGENTS.md 红线 1「core 中任何函数不得读取 B 级字段」不冲突：
 * 红线约束的是业务逻辑不得**依赖** B 级内容，而本函数对 B 级值的处理是
 * 「原样丢弃、不观察、不比较」。安全边界本身必须看得见它要挡的东西。
 */
export function projectArchiveForLLM(archive: ArchiveV1): Record<string, unknown> {
  const projected = projectNode(archive, '')
  /* c8 ignore next */
  if (!projected.keep || !isPlainObject(projected.value)) {
    throw new TypeError('A 级投影的根节点必须是对象')
  }
  return projected.value
}
