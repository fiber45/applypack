/**
 * 自我介绍的分档表与「长度」的定义 —— `intro_*` 这三个 target 的规范来源。
 *
 * ## 先说清楚这里量的是什么
 *
 * DESIGN 10.1 把自我介绍分成四档 × 两种语言：
 *
 * | 档位 | 预算 | 单位 |
 * |---|---|---|
 * | `@60s` / `@3min` | 秒 | 口播 |
 * | `@200w` / `@500w` | 字 / 词 | 书面 |
 *
 * 而 DESIGN 11.5 的验收判据是「字数落在目标档位 **±10%**」—— 落在**字数**上。
 * 所以这里把秒折算成字 / 词，让所有判据都只落在一个量上：
 *
 * ```
 * 口播档的 units = 秒 × 语速   →  intro_zh@60s = 240 字，intro_en@60s = 150 词
 * 书面档的 units = 预算本身
 * ```
 *
 * ## 一处必须说清楚的取舍：±10% 是**双边**判据
 *
 * 页数估算那一套「把误差都朝同一边偏，于是只会误报不会漏报」的做法在这里
 * **不适用** —— 双边带意味着偏哪一边都会失败。所以这里不估算，而是**精确计数**：
 * 字 / 词数是数出来的，不是估出来的。唯一带假设的环节是那个语速常数，
 * 而它被断言钉住，改动必须是有意的。
 *
 * 代价写成一条边界：**「60 秒」实际是「240 字」**。真实的人说话有快慢，
 * 同一个人在不同场合也能差 20%。所以本层能保证的是「按 240 字/分 折算的
 * 时长落在 54–66 秒之间」，而不是「念出来一定是 60 秒」。把语速做成可配置的
 * 参数是下一步的事，不是这里的缺口。
 *
 * ## 计数口径的两处已知偏差（都有上界，都不建模）
 *
 * | 文本 | 实际读法 | 本层怎么算 |
 * |---|---|---|
 * | `4.2` | 「四点二」三拍 | 2（小数点属标点，不计） |
 * | `2025.06` | 「二零二五年六月」七拍 | 4（两位一组被小数点分开） |
 *
 * 偏差只在数字密集处出现，量级是每个小数点多算 1 拍。一段 240 字的自我
 * 介绍里数字位点不超过十来个，累计偏差 < 3%，远小于 ±10% 的带宽 ——
 * 所以不建模，但写在这里（否则它会在某次调试里被当成 bug）。
 *
 * @see DESIGN 10.1 / 10.2 / 11.5 · TASKS.md T4d
 */

import type { RenderLang } from '../render/model'

export type IntroMode =
  /** 口播：预算单位是秒。 */
  | 'spoken'
  /** 书面：预算单位是字（zh）/ 词（en）。 */
  | 'written'

export type IntroTargetName =
  | 'intro_zh@60s'
  | 'intro_zh@3min'
  | 'intro_zh@200w'
  | 'intro_zh@500w'
  | 'intro_en@60s'
  | 'intro_en@3min'
  | 'intro_en@200w'
  | 'intro_en@500w'

export interface IntroTarget {
  readonly name: IntroTargetName
  readonly lang: RenderLang
  readonly mode: IntroMode
  /** 原始预算：口播是秒，书面是字 / 词。 */
  readonly budget: number
  /** 折算后的目标量。**所有判据都落在这个数上。** */
  readonly units: number
  readonly minUnits: number
  readonly maxUnits: number
}

/**
 * 语速常数（每秒几个「字 / 词」）。
 *
 * - 中文 **4.0 字/秒 = 240 字/分**：普通话朗读与演讲的常见区间是 200–260 字/分。
 * - 英文 **2.5 词/秒 = 150 wpm**：英文演讲的建议语速是 130–160 wpm。
 *
 * 两者各自都对（都是真实的语速），但**它们拼在一起时藏着一个未解决的问题**，
 * 记在这里而不是绕过去。
 *
 * ### 已知问题：中英两档「同一档」这句话没有被验证过
 *
 * 下面这段曾是本文件的理由，现在它是**一个被证伪的假设**：
 *
 * > ~~240 字与 150 词承载的信息量大致相当（1 汉字 ≈ 0.6 英语单词），所以
 * > `intro_zh@60s` 与 `intro_en@60s` 是同一档而不是两个碰巧同名的档。~~
 *
 * 同一个事实源、同一批事实，两种语言各自渲染一遍（`campus-archive` 样本 +
 * 它那两份改写产物），实测结果是 **中文 209 字 ↔ 英文 79 词** ——
 * 也就是 **0.38 词/字**，不是 0.6。`intro.test.ts` 里有一条断言把这个数钉住。
 *
 * 于是「60 秒」在两种语言下指向**不同量的事实**：
 *
 * | 档位 | 预算 | 同一批事实填到 |
 * |---|---|---|
 * | `intro_zh@60s` | 240 字（档 216–264） | **209 字 = 87%** —— 差 5 字掉出档外（2%） |
 * | `intro_en@60s` | 150 词（档 135–165） | **79 词 = 53%** —— 差 56 词掉出档外（41%） |
 *
 * 两边都不足，但**量级差 20 倍**：中文那一侧是「一份轻样本恰好差一点」，
 * 英文那一侧是「按这个换算根本填不满」。这两种解释都说得通，而**处置完全不同**：
 *
 * 1. **常数问题**：英文语速常数偏低（150 wpm 是演讲语速，而转述简历要点更接近
 *    口语的 130 wpm），或中文的 4 字/秒偏高。两层都改常数即可 ——
 *    代价是「中英两档是同一档」这句话不再成立，而它正是跨语言数字比对的前提。
 * 2. **内容问题**：一页校招档案里**可朗读**的内容本来就不够一分钟，
 *    中文侧看着接近是因为 4 字/秒算得偏松。那要动的不是常数，
 *    而是「60 秒」这个档位对一页简历是否合理。
 *
 * 判据是 DESIGN 11.5（「自我介绍字数落在目标档位 ±10%」，硬约束），
 * 所以本层**不替它拍板**：`check.ts` 照 ±10% 判，该红就红，
 * 并且把「这可能不是档案的问题」写进失败详情里 —— 但**默认不替用户开脱**。
 * 一次测量区分不了这两种解释；写出来了，它就不会在调试时被当成 bug。
 */

export const SPEAKING_UNITS_PER_SECOND: Readonly<Record<RenderLang, number>> = Object.freeze({
  zh: 4,
  en: 2.5,
})

/** DESIGN 11.5：目标档位 ±10%。 */
export const BUDGET_TOLERANCE = 0.1

/** DESIGN 11.5：英文口播版句均长度 ≤ 25 词（优化目标，不是硬约束）。 */
export const MAX_SPOKEN_SENTENCE_WORDS = 25

const SPECS: readonly (readonly [IntroTargetName, RenderLang, IntroMode, number])[] = Object.freeze([
  ['intro_zh@60s', 'zh', 'spoken', 60],
  ['intro_zh@3min', 'zh', 'spoken', 180],
  ['intro_zh@200w', 'zh', 'written', 200],
  ['intro_zh@500w', 'zh', 'written', 500],
  ['intro_en@60s', 'en', 'spoken', 60],
  ['intro_en@3min', 'en', 'spoken', 180],
  ['intro_en@200w', 'en', 'written', 200],
  ['intro_en@500w', 'en', 'written', 500],
])

function makeTarget(
  name: IntroTargetName,
  lang: RenderLang,
  mode: IntroMode,
  budget: number,
): IntroTarget {
  const units =
    mode === 'spoken' ? Math.round(budget * SPEAKING_UNITS_PER_SECOND[lang]) : budget
  return {
    name,
    lang,
    mode,
    budget,
    units,
    minUnits: Math.round(units * (1 - BUDGET_TOLERANCE)),
    maxUnits: Math.round(units * (1 + BUDGET_TOLERANCE)),
  }
}

export const INTRO_TARGETS: Readonly<Record<IntroTargetName, IntroTarget>> = Object.freeze(
  Object.fromEntries(SPECS.map((spec) => [spec[0], makeTarget(...spec)])) as Record<
    IntroTargetName,
    IntroTarget
  >,
)

export const INTRO_TARGET_NAMES: readonly IntroTargetName[] = Object.freeze(
  SPECS.map((spec) => spec[0]),
)

/**
 * TASKS.md T4d 点名的三档。**默认产出的就是这三个** ——
 * 注意 `intro_en@200w` 在中文侧没有对应档，所以它没有可以两两比较的兄弟
 * （见 `check.ts` 的 `unpaired`）。
 */
export const DEFAULT_INTRO_TARGETS: readonly IntroTargetName[] = Object.freeze([
  'intro_zh@60s',
  'intro_en@60s',
  'intro_en@200w',
])

/**
 * 标点、符号、分隔与**控制字符** —— 都不占说话的时间。
 *
 * `\p{Cc}` 是必须的，而且它不是理论问题：`\p{Z}` 只覆盖空格那一类空白
 * （U+0020、U+3000…），而制表符 `\t` 与换行 `\n` 属于**控制字符**。
 * 少了它，任何带换行的文本都会凭空多出几个「字」——
 * 而症状是「合成器认为塞得下、校验器认为超了」，一句没人看得懂的报错。
 */
const NON_UNIT = /[\p{P}\p{S}\p{Z}\p{Cc}]/u

/** 英文的「词」：以字母或数字开头的一段连续字母 / 数字 / 撇号 / 连字符。 */
const EN_WORD = /[A-Za-z0-9][A-Za-z0-9'’-]*/g

/**
 * 一段文本的「长度」，单位随语言：中文是字，英文是词。
 *
 * 判据与合成**共用这一个函数**。两边各写一份计数迟早会漂移 ——
 * 而那种漂移的症状是「合成器认为塞得下、校验器认为超了」，
 * 用户看到的是一句莫名其妙的报错。
 */
export function introUnits(text: string, lang: RenderLang): number {
  if (lang === 'en') return [...text.matchAll(EN_WORD)].length

  let count = 0
  for (const char of text) {
    if (!NON_UNIT.test(char)) count += 1
  }
  return count
}

/**
 * 切句。**只用于「可朗读性」这一条判据**，不参与长度计算。
 *
 * 两种句末标点必须**分开处理**，因为它们的断句条件不同：
 *
 * | 标点 | 断句条件 | 为什么 |
 * |---|---|---|
 * | `。！？` | 无条件 | 中文句末标点后面通常不写空格（`…38 分钟。我在…`） |
 * | `.?!` | 只在其后是空白或行尾时 | 否则 `4.2`、`2022.09`、`3.7/4.0` 会被切成两句 |
 *
 * 第一版没做这个区分（`(?<=[.?!。！？])\s*`），而 `\s*` 允许零宽 ——
 * 于是每一个小数点都是一个句子边界。症状很隐蔽：`units` 不受影响
 * （它不用切句），只有「句均长度」这一条判据在看句数，而它被
 * 稀释到几乎不可能触发。**一条永远不响的判据和没有这条判据是一样的。**
 */
export function splitSentences(text: string): readonly string[] {
  return text
    .split(/(?<=[。！？])|(?<=[.?!])(?=\s|$)/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '')
}

/** 句均长度（中文按字、英文按词）。空文本返回 0。 */
export function averageSentenceLength(text: string, lang: RenderLang): number {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return 0
  const total = sentences.reduce((sum, sentence) => sum + introUnits(sentence, lang), 0)
  return total / sentences.length
}
