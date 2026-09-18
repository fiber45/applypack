/**
 * 深度扫描器 —— 「三层防空」的第二层（组装层）的第二半。
 *
 * 投影负责「不放进去」，扫描负责「万一放进去了要炸」。两者不能互相替代：
 * 投影是白名单，逻辑上就不该漏；扫描是兜底，它假设投影可能被改错、
 * 或者调用方绕过组装入口自行拼了一个请求。
 *
 * 扫描分两条独立的通道，覆盖的威胁模型完全不同：
 *
 * | 通道 | 抓什么 | 依赖 |
 * |---|---|---|
 * | 路径扫描 | 档案形状的对象里出现了 B 级路径 | 策略表（结构性，不依赖值长短） |
 * | 值扫描 | 出网文本里出现了 B 级**值**（含变形） | 值本身（对短值天然无力） |
 *
 * **值扫描有一个必须写在文档里的固有局限**：它抓不住 2–5 字的短标识符。
 * 用户姓名「张三」出现在任何一段中文里都是合法的，把它当泄漏报出去等于
 * 让整个断言变成噪音。这类短值的防线只有一条 —— 路径扫描 + 投影，
 * 也就是「档案必须以结构化形式进入 payload，且在进入前已被剥掉姓名」。
 * `scanPayload` 把它们归入 `advisory` 而不是 `blocking`，就是为了让这条局限
 * 显式地存在于 API 里，而不是变成一个没人知道的洞。见 `b-level-never-egress.test.ts`。
 */

import { fieldPolicyFor, getAtPath, isCoveredPath, listLeafPaths } from '../schema/index'

export type LeakKind = 'path' | 'value_verbatim' | 'value_normalized' | 'value_advisory'

export interface Leak {
  readonly kind: LeakKind
  /** 泄漏在出网对象中的位置（点分路径）。值扫描给出的是一段文本内的命中，位置为 `<text>`。 */
  readonly where: string
  /** 命中的 B 级档案路径 */
  readonly source: string
  /**
   * 值的脱敏摘要 —— **这里绝不能放完整的 B 级值**。
   * 任何一个把完整手机号写进错误消息的实现，都会让错误日志本身成为泄漏点，
   * 而错误日志通常比请求体更容易被收集。只给首尾各 2 字符与长度。
   */
  readonly preview: string
  readonly severity: 'blocking' | 'advisory'
}

/** 逐字匹配的最小长度。低于它误报率急剧上升，而真实泄漏几乎不会这么短。 */
const MIN_VERBATIM = 4
/** 归一化匹配的最小长度。归一化会抹平分隔符，因此门槛要更高才能保持精度。 */
const MIN_NORMALIZED = 8
/** 进入 advisory 的最小长度。再短的串（'男' / 'C1'）没有识别意义，只会制造噪音。 */
const MIN_ADVISORY = 3

/**
 * 「强标识符」判据 —— 决定一次命中是阻断还是仅提示。
 *
 * 规则：**含数字、含 `@`、或含汉字的值是强标识符**；纯 ASCII 字母词不是。
 *
 * 依据不是「敏感与否」，而是**误报的代价不对称**。真标识符（手机号、身份证、
 * 邮箱、地址、日期）都带结构性字符 —— 数字或 `@`；中文长串在该语境下逐字出现
 * 也是强证据。而 `GitHub`、`linzhiyuan` 这样的纯字母词，在 A 级正文里出现的
 * 最常见原因是**正常提及**（项目 URL 里就带着用户名）。把它们当阻断，
 * 会让第一次跑 CI 就红，而修法只能是「把断言注释掉」—— 那比不写还糟。
 *
 * 代价认领：**纯 ASCII 的短标识符（用户名、英文姓名）只进 advisory，不进阻断集。**
 * 它们的防线是路径扫描 + 投影，不是值扫描。
 */
export function isStrongIdentifier(text: string): boolean {
  return /[0-9@]/.test(text) || /[\u4e00-\u9fff]/.test(text)
}

/** 归一化匹配只对强标识符启用 —— 见 isStrongIdentifier 的依据。 */
function qualifiesForNormalized(text: string): boolean {
  return isStrongIdentifier(text) && /[0-9]/.test(text)
}

/** 只保留数字、字母、汉字，其余全部丢弃，并统一小写。 */
function normalize(text: string): string {
  return text.replace(/[^0-9A-Za-z\u4e00-\u9fff]/g, '').toLowerCase()
}

function preview(value: string): string {
  if (value.length <= 4) return `（${value.length} 字符，过短不显示）`
  return `${value.slice(0, 2)}…${value.slice(-2)}（${value.length} 字符）`
}

/**
 * 收集源对象里全部 B 级叶子的值。
 * 只收集可转成文本的标量；数组与对象本身不是值，其叶子会被逐个收集。
 */
function collectBLevelValues(source: unknown): readonly { path: string; text: string }[] {
  const collected: { path: string; text: string }[] = []
  for (const path of listLeafPaths(source)) {
    const policy = fieldPolicyFor(path)
    if (policy?.level !== 'B') continue

    const current = getAtPath(source, path)
    if (current === null || current === undefined) continue
    if (typeof current !== 'string' && typeof current !== 'number') continue

    const text = String(current)
    if (text.length >= MIN_ADVISORY) collected.push({ path, text })
  }
  return collected
}

/**
 * 路径扫描：找出**档案形状**对象里所有 B 级路径的叶子。
 *
 * 用于验证投影结果。它不依赖值的长短，因此是短标识符（姓名）的唯一可靠防线。
 */
export function findBLevelPaths(value: unknown): readonly string[] {
  return listLeafPaths(value).filter((path) => fieldPolicyFor(path)?.level === 'B')
}

/**
 * 找出任何**没有策略覆盖**的路径。
 *
 * 投影结果不该出现这些路径 —— 出现了说明档案里有策略表不认识的字段，
 * 它的级别未知，因而不能参与出网判定。见 project.ts 里「保守失败」的说明。
 */
export function findUndeclaredPaths(value: unknown): readonly string[] {
  return listLeafPaths(value).filter((path) => !isCoveredPath(path))
}

/**
 * 值扫描：在出网对象的序列化文本里查找源对象的 B 级值。
 *
 * `source` 应是原始档案（未投影的那一份）。拿投影结果当 source 是无效用法 ——
 * 那时候 B 级值已经被丢掉了，扫描必然是空的。
 */
export function scanPayload(payload: unknown, source: unknown): readonly Leak[] {
  let payloadText: string
  try {
    payloadText = JSON.stringify(payload) ?? ''
  } catch {
    // 循环引用等导致无法序列化的对象，其内容也无法通过 JSON 出网，不构成泄漏。
    return []
  }
  const payloadNormalized = normalize(payloadText)

  const leaks: Leak[] = []
  for (const { path, text } of collectBLevelValues(source)) {
    const where = '<text>'

    if (text.length >= MIN_VERBATIM && payloadText.includes(text)) {
      leaks.push({
        kind: 'value_verbatim',
        where,
        source: path,
        preview: preview(text),
        severity: isStrongIdentifier(text) ? 'blocking' : 'advisory',
      })
      continue
    }

    const normalized = normalize(text)
    if (
      qualifiesForNormalized(text) &&
      normalized.length >= MIN_NORMALIZED &&
      payloadNormalized.includes(normalized)
    ) {
      leaks.push({
        kind: 'value_normalized',
        where,
        source: path,
        preview: preview(text),
        severity: 'blocking',
      })
      continue
    }

    // advisory：短标识符在自由文本里无法可靠区分「泄漏」与「正常提及」。
    // 它不进阻断集，但会出现在返回值里，让测试可以显式断言这个已知局限。
    if (payloadNormalized.includes(normalized) || payloadText.includes(text)) {
      leaks.push({ kind: 'value_advisory', where, source: path, preview: preview(text), severity: 'advisory' })
    }
  }
  return leaks
}

/** 阻断集：只要非空就必须炸。 */
export function blockingLeaks(leaks: readonly Leak[]): readonly Leak[] {
  return leaks.filter((leak) => leak.severity === 'blocking')
}
