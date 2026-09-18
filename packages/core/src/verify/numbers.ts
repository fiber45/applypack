/**
 * 数字抽取与溯源比对 —— 幻觉闸门的原子操作。
 *
 * DESIGN 3.3 把「步骤 6 硬校验」称作整份方案的工程质量核心：
 * **模型输出的每一个数字都必须在原文中可溯源，任何新出现的数字直接拒绝并回炉。**
 * 本文件是那条规则的全部实现。它被两处复用：
 *
 *   - 编译期（T2.1）：检查模型抽取的 `numbers` 确实来自它自己给的原文
 *   - 改写期（T3.2）：检查模型改写后的 bullet 没有比原文多出任何数字
 *
 * 实现上刻意保持**纯字符串操作、零依赖、零模型**。理由不是性能，是性质：
 * 一个可以被 LLM 影响的验收器，在被要求「这次就算了吧」的时候是会答应的。
 * 见 AGENTS.md 红线 6。
 */

/**
 * 数字字面量：连续数字，可含小数位或千分位。
 *
 * 已知边界（有意不处理，因为处理它们的代价高于收益）：
 * - **中文数字**（「十二条」「前三名」）不被识别。简历里量化描述几乎都写阿拉伯数字，
 *   为覆盖它们引入一整套中文数字解析，会让这个函数从「可读的二十行」变成
 *   「需要自己写测试的解析器」—— 而漏网的数字只会让闸门更宽松，不会误伤。
 * - **欧式小数**（`1.234,56`）会被读成 `1.23456`。目标用户是中文与英文简历，
 *   两者都用 `1,234.56`。
 */
const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g

/**
 * 归一化：把同一个数的不同写法收敛到同一个字符串。
 *
 * `4.0` 与 `4`、`1,234` 与 `1234` 必须视为相等 —— 否则模型把「4.0 小时」
 * 合理简写成「4 小时」时，闸门会误报成幻觉。溯源的目的是「数字有没有凭空出现」，
 * 不是「写法有没有被改动」。
 */
function normalizeNumber(raw: string): string | null {
  const value = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(value)) return null
  return String(value)
}

/** 抽出文本中全部数字（归一化后，保留重复与顺序）。 */
export function extractNumbers(text: string): readonly string[] {
  const matches = text.match(NUMBER_PATTERN)
  if (matches === null) return []
  const out: string[] = []
  for (const match of matches) {
    const normalized = normalizeNumber(match)
    if (normalized !== null) out.push(normalized)
  }
  return out
}

/** 文本里的数字集合。 */
export function numberSet(text: string): ReadonlySet<string> {
  return new Set(extractNumbers(text))
}

/**
 * 找出输出里**无法在来源中找到**的数字 —— 也就是模型编出来的那些。
 *
 * 返回的是数字本身（已归一化），升序排列以保证输出稳定：调用方要拿它
 * 拼错误消息、写进结构化失败对象（DESIGN 8.5），顺序不稳定会让快照断言失效。
 */
export function untraceableNumbers(output: string, sources: readonly string[]): readonly string[] {
  const available = new Set<string>()
  for (const source of sources) {
    for (const value of extractNumbers(source)) available.add(value)
  }
  const offenders = new Set<string>()
  for (const value of extractNumbers(output)) {
    if (!available.has(value)) offenders.add(value)
  }
  return [...offenders].sort(compareNumeric)
}

/** 按数值大小排序；非数值（理论上不会出现）退化为字典序。 */
function compareNumeric(a: string, b: string): number {
  const left = Number(a)
  const right = Number(b)
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right
  return a < b ? -1 : a > b ? 1 : 0
}
