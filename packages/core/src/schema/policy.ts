import { archiveV1Policies } from './archive'
import type { FieldPolicy } from './level'

/**
 * 字段策略的查询层 —— 出网组装层与测试层共用的唯一入口。
 *
 * 路径匹配规则：**最长前缀命中**。
 * 策略表里的 `work` 是一条叶子策略，它覆盖 `work.0.highlights.0` 这样的实际叶子路径；
 * 因此查询时从最长候选开始逐级缩短，第一个命中的即为答案。
 * 数组下标不参与语义，`work.0` 与 `work.7` 落到同一条策略。
 *
 * @see AGENTS.md §6 「三层防空」的组装层
 */

const POLICY_BY_PATH: ReadonlyMap<string, FieldPolicy> = new Map(
  archiveV1Policies.map((policy) => [policy.path, policy]),
)

/** 按路径字典序排序，让快照断言稳定 */
const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const A_LEVEL_PATHS: readonly string[] = Object.freeze(
  archiveV1Policies
    .filter((policy) => policy.level === 'A')
    .map((policy) => policy.path)
    .sort(byPath),
)

const B_LEVEL_PATHS: readonly string[] = Object.freeze(
  archiveV1Policies
    .filter((policy) => policy.level === 'B')
    .map((policy) => policy.path)
    .sort(byPath),
)

/** 全部字段策略，顺序为声明顺序 */
export function fieldPolicies(): readonly FieldPolicy[] {
  return archiveV1Policies
}

export function aLevelPaths(): readonly string[] {
  return A_LEVEL_PATHS
}

export function bLevelPaths(): readonly string[] {
  return B_LEVEL_PATHS
}

/**
 * 解析某个实际路径的字段策略。
 * 返回 `undefined` 表示该路径**没有被任何策略覆盖** —— 在出网组装里这属于危险信号，
 * 调用方必须当成 B 级处理（保守失败），而不是放行。
 */
export function fieldPolicyFor(path: string): FieldPolicy | undefined {
  const segments = path.split('.')
  for (let length = segments.length; length >= 1; length -= 1) {
    const hit = POLICY_BY_PATH.get(segments.slice(0, length).join('.'))
    if (hit !== undefined) return hit
  }
  return undefined
}

/** 路径是否有策略覆盖 */
export function isCoveredPath(path: string): boolean {
  return fieldPolicyFor(path) !== undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 可下标访问 —— 对象**与数组**都算。
 *
 * 这里不能复用 `isPlainObject`：`listLeafPaths` 会给数组产出 `profiles.0.network`
 * 这样的数字下标路径，而数组不是 plain object。用 `isPlainObject` 判断会让
 * 任何穿过数组的路径在第一步就中断、静默返回 `undefined` —— 于是整棵
 * `basics.profiles` 的 B 级值都不会被扫描器看到。**漏报，且没有任何症状。**
 */
function isIndexable(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** 按点分路径取值，任一段不存在则返回 `undefined` */
export function getAtPath(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!isIndexable(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/**
 * 列出对象里全部叶子路径（点分，数组用数字下标）。
 *
 * 用途是让「策略表 ↔ 真实档案」可以双向对账：
 * 策略漏了字段、或写了档案里根本不存在的幽灵字段，都会在这里暴露。
 */
export function listLeafPaths(value: unknown, prefix = ''): readonly string[] {
  if (Array.isArray(value)) {
    if (value.length === 0) return prefix === '' ? [] : [prefix]
    return value.flatMap((item, index) =>
      listLeafPaths(item, prefix === '' ? String(index) : `${prefix}.${index}`),
    )
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return prefix === '' ? [] : [prefix]
    return entries.flatMap(([key, item]) =>
      listLeafPaths(item, prefix === '' ? key : `${prefix}.${key}`),
    )
  }
  return prefix === '' ? [] : [prefix]
}
