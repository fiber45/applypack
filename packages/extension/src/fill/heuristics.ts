import type { FieldFeature } from './features'
import { isFillableKind, type CatalogEntry } from './catalog'

/**
 * 启发式匹配的评分器 —— 适配器没接住的长尾站点走这里（DESIGN 3.4）。
 *
 * ## 评分不是智能，是带闸门的字符串对账
 *
 * 三类信号，各自有权重上限（取最大值，不累加 —— 累加会让「三个弱线索
 * 顶一个强线索」，而弱线索经常互相来自同一个错误的标签）：
 *
 * | 信号 | 精确相等 | 包含 |
 * |---|---|---|
 * | labels（label / aria 等页面文案） | 10 | 6 |
 * | name / id | 7 | 4 |
 * | placeholder | 5 | 3 |
 *
 * **类型闸门先于一切**：字段的 kind 不在条目的 `kinds` 里 → 直接 0 分。
 * `<input type="tel">` 标签写错了也不该接 email 的值 —— 闸门保证
 * 「错得离谱的匹配」根本不进候选池，这是「填错比不填更糟」的第一道执行点。
 */

export type ScorableFieldFeature = Pick<
  FieldFeature,
  'kind' | 'labels' | 'name' | 'id' | 'placeholder'
>

/**
 * 归一化：小写、剥空白与常见装饰符（`*` 是必填标记不是文案，
 * `_` / `-` / `·` 是命名风格差异）。归一化必须先于一切比较 ——
 * 朴素 `contains` 在 `display:flex` 上翻车的教训（T4c）同款。
 */
export function normalizeLabeling(raw: string): string {
  return raw.toLowerCase().replace(/[\s*·_\-—/]/g, '')
}

const SCORES = Object.freeze({
  labelExact: 10,
  labelContains: 6,
  nameExact: 7,
  nameContains: 4,
  placeholderExact: 5,
  placeholderContains: 3,
})

/** 0 = 没有任何信号（不进候选池）。>0 = 候选。 */
export function scoreCatalogEntry(
  entry: CatalogEntry | undefined,
  feature: ScorableFieldFeature,
): number {
  if (entry === undefined) return 0
  // 闸门：file / checkbox 这类不可填 kind 也不可能命中（它们的 kind
  // 不在任何条目的 kinds 里），但显式拦一道 —— 闸门的语义要自己站得住。
  if (!isFillableKind(feature.kind)) return 0
  // isFillableKind 已拦下 file / checkbox；剩下的是 FieldKind ⊆ 值域的收窄，
  // 用字符串口径比较而不是把 kind 强转成更窄的类型。
  if (!(entry.kinds as readonly string[]).includes(feature.kind)) return 0

  let best = 0

  for (const label of feature.labels) {
    best = Math.max(best, textScore(label, entry.synonyms, SCORES.labelExact, SCORES.labelContains))
  }

  for (const identifier of [feature.name, feature.id]) {
    if (identifier === null) continue
    best = Math.max(best, textScore(identifier, entry.synonyms, SCORES.nameExact, SCORES.nameContains))
  }

  if (feature.placeholder !== null) {
    best = Math.max(
      best,
      textScore(feature.placeholder, entry.synonyms, SCORES.placeholderExact, SCORES.placeholderContains),
    )
  }

  return best
}

function textScore(
  raw: string,
  synonyms: readonly string[],
  exactScore: number,
  containsScore: number,
): number {
  const text = normalizeLabeling(raw)
  if (text === '') return 0

  for (const synonym of synonyms) {
    if (normalizeLabeling(synonym) === text) return exactScore
  }
  for (const synonym of synonyms) {
    const normalized = normalizeLabeling(synonym)
    // 只做「同义词 ⊆ 文本」方向：反向（文本 ⊆ 同义词）会把
    // 「验证码」这种短标签对进长同义词里，误报换不回覆盖。
    //
    // 短 ASCII 同义词（≤4 字符）不做包含匹配：`name` ⊆ `candidate_name`、
    // `mail` ⊆ `gmail_xxx` 这类子串命中是纯噪音 —— 英文单词没有中文那种
    // 「字面包含 ≈ 语义相关」的性质，短词必须精确。
    if (isShortAsciiToken(normalized)) continue
    if (text.includes(normalized)) return containsScore
  }
  return 0
}

function isShortAsciiToken(normalized: string): boolean {
  return normalized.length <= 4 && /^[a-z0-9]+$/.test(normalized)
}
