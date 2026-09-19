/**
 * 合成器 —— 把事实源按档位预算摊成三个视图。
 *
 * ## 这是**草稿**，不是终稿
 *
 * 本模块是确定性的：同样的档案永远得到同样的文本，且**不经过模型**。
 * 它有两个职责：
 *
 * 1. 把「同一份事实源 → 三个档位」这件事做出来（T4d 第一条勾的可见证据）；
 * 2. 让「数字集合相等」在结构上成立 —— 事实里的数字是从简历要点上抄下来的，
 *    所以草稿里**不可能出现简历上没有的数字**。
 *
 * 而它产出的句子是「可朗读的要点稿」，不是打磨过的口播稿（`在某某公司做某职位期间，
 * 主导召回通道的特征工程，上线 12 个特征。`）。让它读起来像人说话的那一步，
 * 与 T3.1 的小改写同款（一次模型调用），并且**润色不得引入新数字** ——
 * 那正是 `check.ts` 的 `intro_unsupported_number` 守的东西。
 *
 * 顺序不能反过来。先让模型自由写一份自我介绍、再拿数字去校验，等于把
 * 「不许编数字」这件事交给提示词；先确定性成稿、再润色，则「编数字」在草稿阶段
 * 就不存在，而润色阶段的编造会被一条比对抓住。**能做成不可能的，就不要做成被检测的。**
 *
 * ## 「带数字的事实同进同出」
 *
 * 选择事实时，一条事实有两种处置：
 *
 * | 事实 | 处置 |
 * |---|---|
 * | 带数字（`numbers.length > 0`） | 两种语言**同进同出**：任一侧装不下就两边都不收 |
 * | 不带数字 | 各自决定：中文装得下就中文收，英文装得下就英文收 |
 *
 * 这条规则是「中英两版数字集合必须相等」（DESIGN 10.2）在结构上的实现 ——
 * 带数字的事实既然两边都收，它的数字就两边都有。而不带数字的事实允许不对称，
 * 是为了不让两边互相拖累：英文表达通常比中文短，若一切都同进同出，
 * 英版会稳定地填不满预算（60 秒档的英文下限是 135 词，而同一批事实的
 * 英文写法往往到不了）。
 *
 * 于是那条校验退化成**回归绊线**：它响的时候说的是「模板漂移了」
 * （某次改动让英文模板丢掉了 `2021.09`），不是「用户档案有问题」。
 * 它必须仍然能响 —— `intro.test.ts` 里有一条断言手工构造漂移喂给它。
 *
 * ## 累加的长度必须与重算的长度相等
 *
 * 选择时用的是「逐条累加的 units」，而视图对外报的 `units` 是**从最终文本重算**的。
 * 两者必须相等，否则会出现「合成器以为塞得下、校验器认为超了」这种
 * 无人能懂的报错。`intro.test.ts` 里有一条断言把两者钉在一起。
 */

import type { RenderLang } from '../render/model'
import type { IntroFact, IntroFactKind } from './facts'
import { introUnits, splitSentences, type IntroTarget } from './targets'

export type IntroSkipReason = /** 这一条放不进这个档位。 */
  'no_room'

export interface IntroSkip {
  readonly id: string
  readonly kind: IntroFactKind
  readonly reason: IntroSkipReason
  /** 这条事实需要多少 units。 */
  readonly need: number
  /** 剩余空间（可能为负 —— 例如 `identity` 必收时挤掉的空间）。 */
  readonly remaining: number
}

export interface IntroView {
  readonly target: IntroTarget
  readonly text: string
  readonly sentences: readonly string[]
  /** 从 `text` **重算**的长度，不是选择时的累加值。见文件头。 */
  readonly units: number
  /** 收进来的事实 id，按 `rank` 顺序。 */
  readonly factIds: readonly string[]
  /**
   * 收进来的事实里，英文侧**直接复用了中文原文**的那些（`IntroFact.zhFallback`）。
   *
   * 只对英文视图有意义 —— 中文视图的这一列必然为空。它是「这一档为什么短」
   * 的**首要解释**：英文档偏短的第一成因不是档案里事实不够，而是英文侧
   * 还没被写出来，而这两件事的处置完全不同（见 `check.ts` 的 `intro_too_short`）。
   */
  readonly zhFallbackFactIds: readonly string[]
  /** 没收进来的事实与原因。**越级必须报出来**，见 `facts.ts` 的取舍 ②。 */
  readonly skipped: readonly IntroSkip[]
}

export interface IntroPair {
  /** 档位键（`60s` / `3min` / `200w` / `500w`）—— 中英两档靠它配对。 */
  readonly key: string
  readonly zh: IntroView | null
  readonly en: IntroView | null
}

/** 一条事实加入后的中间结果。 */
interface Accumulator {
  readonly parts: string[]
  readonly ids: string[]
  readonly zhFallbackIds: string[]
  readonly skipped: IntroSkip[]
  used: number
}

function newAccumulator(): Accumulator {
  return { parts: [], ids: [], zhFallbackIds: [], skipped: [], used: 0 }
}

/**
 * 合成一对（或单侧）视图。
 *
 * 两侧的 `IntroTarget` 都可为 `null`，表示「这一档在这个语言下不存在」——
 * 例如 TASKS.md T4d 点名的 `intro_en@200w` 在中文侧没有对应档。
 * 为 `null` 的一侧视为「空间无限」，这样同一条选择逻辑可以覆盖三种情形
 * （中英成对 / 只有中文 / 只有英文），而不是各写一套。
 */
export function composeIntroPair(
  facts: readonly IntroFact[],
  key: string,
  zhTarget: IntroTarget | null,
  enTarget: IntroTarget | null,
): IntroPair {
  const zh = newAccumulator()
  const en = newAccumulator()

  for (const fact of facts) {
    const zhNeed = introUnits(fact.zh, 'zh')
    const enNeed = introUnits(fact.en, 'en')
    const zhFits = zhTarget === null || zh.used + zhNeed <= zhTarget.maxUnits
    const enFits = enTarget === null || en.used + enNeed <= enTarget.maxUnits

    // 身份必收，即使它自己就超过了上限（那时 `intro_too_long` 会响）。
    // 一份没有姓名与定位的自我介绍不是自我介绍。
    const mandatory = fact.kind === 'identity'
    const takeZh = zhTarget !== null && (mandatory || (fact.numbers.length === 0 ? zhFits : zhFits && enFits))
    const takeEn = enTarget !== null && (mandatory || (fact.numbers.length === 0 ? enFits : zhFits && enFits))

    if (takeZh) {
      zh.parts.push(fact.zh)
      zh.ids.push(fact.id)
      if (fact.zhFallback) zh.zhFallbackIds.push(fact.id)
      zh.used += zhNeed
    } else if (zhTarget !== null) {
      zh.skipped.push({ id: fact.id, kind: fact.kind, reason: 'no_room', need: zhNeed, remaining: (zhTarget.maxUnits - zh.used) })
    }

    if (takeEn) {
      en.parts.push(fact.en)
      en.ids.push(fact.id)
      if (fact.zhFallback) en.zhFallbackIds.push(fact.id)
      en.used += enNeed
    } else if (enTarget !== null) {
      en.skipped.push({ id: fact.id, kind: fact.kind, reason: 'no_room', need: enNeed, remaining: (enTarget.maxUnits - en.used) })
    }
  }

  return {
    key,
    zh: zhTarget === null ? null : finish(zhTarget, zh, 'zh'),
    en: enTarget === null ? null : finish(enTarget, en, 'en'),
  }
}

function finish(target: IntroTarget, accumulator: Accumulator, lang: RenderLang): IntroView {
  // 中文句子自带句末标点，直接相接；英文需要空格。
  const text = accumulator.parts.join(lang === 'zh' ? '' : ' ')
  return {
    target,
    text,
    sentences: splitSentences(text),
    units: introUnits(text, lang),
    factIds: accumulator.ids,
    zhFallbackFactIds: accumulator.zhFallbackIds,
    skipped: accumulator.skipped,
  }
}
