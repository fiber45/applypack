/**
 * `core/intro` —— 中英自我介绍的分档生成（T4d）。
 *
 * 四个子模块各有一句话职责：
 *
 * - `targets` —— 八个档位（四档 × 两种语言）+ 语速常数 + 「长度」的计数口径
 * - `facts` —— 从**简历的文档模型**取事实，一条事实带两种语言的渲染（T4d 第一条勾）
 * - `compose` —— 按档位预算摊成草稿；带数字的事实同进同出
 * - `check` —— 数字集合纳入 T4b 的统一校验（T4d 第二条勾）
 *
 * ## 本模块为什么属于 `core`
 *
 * 它与 `core/render` 是同一类东西：**B 级数据进入产出物的模块**。
 * 自我介绍里有姓名、公司、学校 —— 与简历上的那些是同一批字段，
 * 都是**从不经过模型请求的确定性代码**写进产物的（DESIGN 1.3）。
 *
 * ## 「不经过模型」在这里是一句可以断言的话
 *
 * `buildIntroViews` 的签名里没有 `LLMClient`，也拿不到档案之外的任何东西 ——
 * 它的输入是一份档案与已渲染的简历文本。整条链路没有任何 `await`：
 * 一次真实网络调用必然是异步的，所以「本层不出网」不是承诺，是可写、可断言的事实。
 *
 * @see DESIGN 10.1 / 10.2 / 11.5 · TASKS.md T4d
 */

import { buildDocumentModel, type RenderLang } from '../render/model'
import type { ArchiveV1 } from '../schema/index'
import { checkIntros, type IntroCheck, type ResumeTexts } from './check'
import { composeIntroPair, type IntroPair, type IntroView } from './compose'
import { introFacts, type IntroFact } from './facts'
import {
  DEFAULT_INTRO_TARGETS,
  INTRO_TARGETS,
  type IntroTargetName,
} from './targets'

export interface IntroBuildOptions {
  /** 要产出哪些档位。省略即 TASKS.md T4d 点名的三档。 */
  readonly targets?: readonly IntroTargetName[]
  /** 只收这些条目（来自匹配结果，T2.2）。省略即全部收。 */
  readonly includedEntryIds?: readonly string[]
  /** 逐语种的改写产物（T3.1 的两次独立调用）。省略即用档案原文。 */
  readonly rewritten?: Partial<Record<RenderLang, ReadonlyMap<string, readonly string[]>>>
  /**
   * 已渲染简历的**文本行**（`PackageView.texts`）。**必填。**
   *
   * 为什么必填而不是省略时跳过那条校验：省略即静默少一条判据，
   * 而「少了一条判据」是没有任何症状的（T1.4 的教训）。
   *
   * 为什么是文本行而不是文档模型：与 T4b 同一个理由 —— 模型是
   * 「我们打算渲染什么」，文本行是「渲染出来实际是什么」。转义、语言回退、
   * 节顺序都发生在两者之间，而「自述里出现了简历上没有的数字」恰恰最可能
   * 由它们造成。拿模型去比，等于在一半的路上设检查站。
   */
  readonly resumeTexts: ResumeTexts
}

export interface IntroPackage {
  /** 合成用的事实源（已按 `rank` 排序）。导出它是为了让「三档共用」可被断言。 */
  readonly facts: readonly IntroFact[]
  /** 按请求顺序排列的视图。 */
  readonly views: readonly IntroView[]
  /** 按档位键（`60s` / `200w` / …）配对的结果。 */
  readonly pairs: readonly IntroPair[]
  readonly check: IntroCheck
}

function budgetKey(name: IntroTargetName): string {
  return name.slice(name.indexOf('@') + 1)
}

function optionsFor(
  target: 'resume_zh' | 'resume_en_campus',
  lang: RenderLang,
  options: IntroBuildOptions,
) {
  const rewritten = options.rewritten?.[lang]
  return {
    target,
    ...(options.includedEntryIds === undefined
      ? {}
      : { includedEntryIds: options.includedEntryIds }),
    ...(rewritten === undefined ? {} : { rewritten }),
  }
}

/**
 * 产出自我介绍。
 *
 * 顺序是固定的：先建两个 `DocumentModel`（与简历用的是同一个函数、同一份
 * `SECTION_ORDER`），再从它们抽事实，再按档位键配对合成。**同一次调用里
 * 两个语言读到的是同一份事实源** —— 这是 T4d 第一条勾的落地方式，
 * 而不是「两边都去读档案、但愿读的一样」。
 */
export function buildIntroViews(
  archive: ArchiveV1,
  options: IntroBuildOptions,
): IntroPackage {
  const requested = options.targets ?? DEFAULT_INTRO_TARGETS

  const zhModel = buildDocumentModel(archive, optionsFor('resume_zh', 'zh', options))
  const enModel = buildDocumentModel(archive, optionsFor('resume_en_campus', 'en', options))
  const facts = introFacts({ zh: zhModel, en: enModel })

  // 同一档位键下的中英两档要一起合成：带数字的事实同进同出，所以
  // 「哪几条事实被收」这个决定必须在两语言之间共享（见 compose.ts）。
  const keys = [...new Set(requested.map(budgetKey))]
  const pairs = keys.map((key) => {
    const of = (lang: RenderLang): IntroTargetName | undefined =>
      requested.find((name) => budgetKey(name) === key && INTRO_TARGETS[name].lang === lang)
    const zhName = of('zh')
    const enName = of('en')
    return composeIntroPair(
      facts,
      key,
      zhName === undefined ? null : INTRO_TARGETS[zhName],
      enName === undefined ? null : INTRO_TARGETS[enName],
    )
  })

  const byName = new Map<string, IntroView>()
  for (const pair of pairs) {
    if (pair.zh !== null) byName.set(pair.zh.target.name, pair.zh)
    if (pair.en !== null) byName.set(pair.en.target.name, pair.en)
  }
  const views = requested
    .map((name) => byName.get(name))
    .filter((view): view is IntroView => view !== undefined)

  return {
    facts,
    views,
    pairs,
    check: checkIntros({ views, pairs, resumeTexts: options.resumeTexts }),
  }
}

export {
  BUDGET_TOLERANCE,
  DEFAULT_INTRO_TARGETS,
  INTRO_TARGETS,
  INTRO_TARGET_NAMES,
  MAX_SPOKEN_SENTENCE_WORDS,
  SPEAKING_UNITS_PER_SECOND,
  averageSentenceLength,
  introUnits,
  splitSentences,
  type IntroMode,
  type IntroTarget,
  type IntroTargetName,
} from './targets'
export { INCLUDED_SECTIONS, introFacts, type IntroFact, type IntroFactKind, type IntroModels } from './facts'
export {
  composeIntroPair,
  type IntroPair,
  type IntroSkip,
  type IntroSkipReason,
  type IntroView,
} from './compose'
export {
  checkIntros,
  type IntroCheck,
  type IntroCheckInput,
  type IntroFinding,
  type IntroFindingReason,
  type ResumeTexts,
} from './check'
