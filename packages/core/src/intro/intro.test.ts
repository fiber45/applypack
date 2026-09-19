/**
 * T4d 的验收 —— 自我介绍三视图。
 *
 * TASKS.md 的两条勾各自对应本文件里的一节：
 *
 * | 勾 | 守它的断言 |
 * |---|---|
 * | 三档共用同一事实源 | 「同一批事实、同一次排序、同一组 id」那一节 —— 包括 `factIds` 有序、三档是同一序列的子集、以及事实源不随档位变化 |
 * | 数字集合纳入 T4b 的统一校验 | 「校验器」那一节 —— 含两条**反向验证**（篡改必须失败）与一条「比较真的在跑」的证明 |
 *
 * 反向验证的写法沿用 T4b / T4c：**一条绿只有在它能红的时候才算绿**。
 * 所以每一条 fatal 判据都配一个「手工构造违反」的用例，而不是只测干净输入。
 *
 * 本文件里另外有两节不服务于验收，服务于**下一次调试的人**：
 *
 * - 「档位换算」—— 把 `targets.ts` 里那个未拍板的常数问题量成一个数
 * - 「校准温度计」—— 记录同一批事实在中英两档下各填到多少，改动模板时它会动
 */

import { describe, expect, it } from 'vitest'

import { campusArchiveV1, campusRewritten } from '../render/__fixtures__/campus-archive'
import { buildDeliveryPackage, type DeliveryPackage } from '../render/package'
import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { extractNumbers, numberSet } from '../verify/numbers'
import { checkIntros, type ResumeTexts } from './check'
import { composeIntroPair, type IntroPair, type IntroView } from './compose'
import { INCLUDED_SECTIONS, type IntroFact, type IntroFactKind } from './facts'
import { buildIntroViews, type IntroPackage } from './index'
import {
  BUDGET_TOLERANCE,
  DEFAULT_INTRO_TARGETS,
  INTRO_TARGETS,
  INTRO_TARGET_NAMES,
  MAX_SPOKEN_SENTENCE_WORDS,
  SPEAKING_UNITS_PER_SECOND,
  averageSentenceLength,
  introUnits,
  splitSentences,
  type IntroTargetName,
} from './targets'

function resumeTextsOf(pkg: DeliveryPackage): ResumeTexts {
  return { zh: pkg.views.cn.texts, en: pkg.views.en.texts }
}

/** 不带改写的基准包：英文侧全是中文原文，`zhFallback` 应当到处为真。 */
const CAMPUS_PLAIN_PKG = buildDeliveryPackage(campusArchiveV1)
const CAMPUS_PLAIN = buildIntroViews(campusArchiveV1, {
  resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
})

/** 带 T4b 那两份改写产物的包。 */
const CAMPUS_REWRITTEN_PKG = buildDeliveryPackage(campusArchiveV1, { rewritten: campusRewritten })
const CAMPUS_REWRITTEN = buildIntroViews(campusArchiveV1, {
  rewritten: campusRewritten,
  resumeTexts: resumeTextsOf(CAMPUS_REWRITTEN_PKG),
})

const MAXIMAL_PKG = buildDeliveryPackage(maximalArchiveV1)
const MAXIMAL = buildIntroViews(maximalArchiveV1, { resumeTexts: resumeTextsOf(MAXIMAL_PKG) })

function viewOf(pkg: IntroPackage, name: IntroTargetName): IntroView {
  const view = pkg.views.find((candidate) => candidate.target.name === name)
  if (view === undefined) throw new Error(`视图不存在：${name}`)
  return view
}

function reasonsOf(pkg: IntroPackage): readonly string[] {
  return pkg.check.findings.map((finding) => finding.reason)
}

// ---------------------------------------------------------------- 合成用的假事实

/**
 * 造一条事实。**数字集合从两种语言的文本各抽一遍再取并集** ——
 * 与 `facts.ts` 的 `numbersOf` 同一个口径。口径不一致的话，本文件测的
 * 就是假事实的性质，不是真事实的性质。
 */
function fact(id: string, kind: IntroFactKind, zh: string, en: string): IntroFact {
  return {
    id,
    kind,
    rank: 0,
    zh,
    en,
    numbers: [...new Set([...extractNumbers(zh), ...extractNumbers(en)])],
    zhFallback: false,
  }
}

/** 造一批事实，`rank` 按给定顺序递增（合成器只吃数组顺序，但 rank 不该说谎）。 */
function factsOf(specs: readonly (readonly [string, IntroFactKind, string, string])[]): readonly IntroFact[] {
  return specs.map(([id, kind, zh, en], index) => ({ ...fact(id, kind, zh, en), rank: index }))
}

/** 一段只有长度有意义的填充文本。 */
function filler(unit: string, times: number): string {
  return Array.from({ length: times }, () => unit).join('')
}

const IDENTITY = ['identity', 'identity', '我是林知远，算法工程应届生。', "I'm Lin Zhiyuan, a new-grad algorithm engineer."] as const

/** 一段填充用的经历要点：不带数字，好让它只受长度这一件事影响。 */
const FILLER_ZH = '我在一家公司做过召回通道的特征工程，把回填链路的耗时压了下来。'
const FILLER_EN =
  'I worked on feature engineering for the recall channel and brought the backfill latency down.'

// ------------------------------------------------------------------------ 档位表

describe('档位表', () => {
  it('八个档位、四个预算、两种语言', () => {
    expect(INTRO_TARGET_NAMES).toHaveLength(8)
    expect(new Set(INTRO_TARGET_NAMES).size).toBe(8)
  })

  it('档位名里的语言与档位本身一致', () => {
    // 名字说的是 zh 而对象说的是 en，`buildIntroViews` 会照对象把它配到英文档上 ——
    // 症状是「中文档里读出了英文」，不报错。所以这条是必须的。
    for (const name of INTRO_TARGET_NAMES) {
      const target = INTRO_TARGETS[name]
      expect(target.lang).toBe(name.includes('_zh@') ? 'zh' : 'en')
    }
  })

  it('记录里的键与档位自己的 name 不会分叉', () => {
    for (const name of INTRO_TARGET_NAMES) expect(INTRO_TARGETS[name].name).toBe(name)
  })

  it('口播档按语速折算，书面档直接用预算', () => {
    for (const name of INTRO_TARGET_NAMES) {
      const target = INTRO_TARGETS[name]
      const expected =
        target.mode === 'spoken'
          ? Math.round(target.budget * SPEAKING_UNITS_PER_SECOND[target.lang])
          : target.budget
      expect(target.units).toBe(expected)
    }
  })

  it('带宽是 ±10%，且上下界都取整', () => {
    for (const name of INTRO_TARGET_NAMES) {
      const target = INTRO_TARGETS[name]
      expect(target.minUnits).toBe(Math.round(target.units * (1 - BUDGET_TOLERANCE)))
      expect(target.maxUnits).toBe(Math.round(target.units * (1 + BUDGET_TOLERANCE)))
      expect(target.minUnits).toBeLessThan(target.maxUnits)
    }
  })

  it('三个具体档位的数字与 DESIGN 10.1 一致', () => {
    expect(INTRO_TARGETS['intro_zh@60s'].units).toBe(240)
    expect(INTRO_TARGETS['intro_en@60s'].units).toBe(150)
    expect(INTRO_TARGETS['intro_en@200w'].units).toBe(200)
  })

  it('默认产出的是 TASKS.md T4d 点名的那三档', () => {
    expect([...DEFAULT_INTRO_TARGETS]).toEqual(['intro_zh@60s', 'intro_en@60s', 'intro_en@200w'])
    for (const name of DEFAULT_INTRO_TARGETS) expect(INTRO_TARGET_NAMES).toContain(name)
  })
})

// ------------------------------------------------------------------ 计数与切句

describe('长度计数与切句', () => {
  it('中文只数非标点、非空白、非控制字符', () => {
    expect(introUnits('我是林知远。', 'zh')).toBe(5)
    // 制表符与换行属控制字符，不是 `\p{Z}` —— 少了 `\p{Cc}` 的话这里是 6。
    expect(introUnits('一 二\t三\n四', 'zh')).toBe(4)
    expect(introUnits('', 'zh')).toBe(0)
  })

  it('英文按「以字母或数字开头的一段」数词', () => {
    expect(introUnits('I studied at Zhejiang University.', 'en')).toBe(5)
    // 撇号与连字符在词内，不切成两个词。
    expect(introUnits("Bachelor's Degree, CET-6", 'en')).toBe(3)
    expect(introUnits('', 'en')).toBe(0)
  })

  it('小数点不是句边界（回归：第一版把它当成了边界）', () => {
    expect(splitSentences('把离线特征回填耗时从 4.2 小时降至 38 分钟。')).toHaveLength(1)
    expect(splitSentences('时间是 2022.09 – 2026.06。')).toHaveLength(1)
    expect(splitSentences('GPA 3.7/4.0 的水平。')).toHaveLength(1)
  })

  it('英文句号后面有空白或到行尾才断句', () => {
    expect(splitSentences('I shipped 12 features. Then I left.')).toHaveLength(2)
    expect(splitSentences('I shipped 12 features.')).toHaveLength(1)
  })

  it('中文句号后不要求空格', () => {
    expect(splitSentences('我是林知远。我在某大学读书。')).toHaveLength(2)
  })

  it('英文的 4.2 计两「词」，中文的 4.2 计两「字」—— 两边口径一致', () => {
    expect(introUnits('4.2', 'en')).toBe(2)
    expect(introUnits('4.2', 'zh')).toBe(2)
  })

  it('句均长度在空文本上是 0 而不是 NaN', () => {
    expect(averageSentenceLength('', 'en')).toBe(0)
    expect(averageSentenceLength('One two three.', 'en')).toBe(3)
  })

  it('切句的依据是标点，与长度口径不是同一件事', () => {
    // 句数由标点决定，`units` 由字符 / 词决定。两者混用会让「句均」这一条
    // 在长句里被稀释 —— 目标层的判据因此必须只用其中一个。
    const text = '我是林知远。我在某某大学读计算机科学与技术。'
    expect(splitSentences(text)).toHaveLength(2)
    expect(introUnits(text, 'zh')).toBe(20)
  })
})

// -------------------------------------------------------------------- 事实源

describe('事实源（T4d 第一条勾）', () => {
  it('id 互不相同 —— 重名的症状是静默丢一条事实', () => {
    for (const pkg of [CAMPUS_PLAIN, CAMPUS_REWRITTEN, MAXIMAL]) {
      const ids = pkg.facts.map((item) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('按 rank 升序，第一条永远是身份', () => {
    for (const pkg of [CAMPUS_PLAIN, MAXIMAL]) {
      const ranks = pkg.facts.map((item) => item.rank)
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
      expect(pkg.facts[0]?.kind).toBe('identity')
    }
  })

  it('白名单之外的节不进事实源', () => {
    // maximal 有 languages / awards / certificates 三个节，都填满了。
    const ids = MAXIMAL.facts.map((item) => item.id)
    for (const section of ['languages', 'awards', 'certificates']) {
      expect(ids.some((id) => id.startsWith(`${section}.`))).toBe(false)
      expect(INCLUDED_SECTIONS).not.toContain(section)
    }
  })

  it('白名单是四条，且每一条都真的进了事实源', () => {
    expect([...INCLUDED_SECTIONS]).toEqual(['education', 'work', 'projects', 'skills'])
    const ids = MAXIMAL.facts.map((item) => item.id)
    for (const section of INCLUDED_SECTIONS) {
      expect(ids.some((id) => id.startsWith(`${section}.`))).toBe(true)
    }
  })

  it('每条事实两种语言都有文本', () => {
    for (const pkg of [CAMPUS_PLAIN, MAXIMAL]) {
      for (const item of pkg.facts) {
        expect(item.zh.trim()).not.toBe('')
        expect(item.en.trim()).not.toBe('')
      }
    }
  })

  it('每条事实两种语言的数字集合相等 —— 这是跨语言判据能成立的前提', () => {
    // 这一条不满足时，「中英数字相等」会在**数据**上红，而不是在模板上红。
    // 把前提单独测出来，两种红的成因才不会混在一起。
    for (const pkg of [CAMPUS_PLAIN, CAMPUS_REWRITTEN, MAXIMAL]) {
      for (const item of pkg.facts) {
        expect(new Set(extractNumbers(item.en))).toEqual(new Set(extractNumbers(item.zh)))
      }
    }
  })

  it('`numbers` 是两种语言数字的并集', () => {
    for (const pkg of [CAMPUS_PLAIN, MAXIMAL]) {
      for (const item of pkg.facts) {
        const expected = new Set([...extractNumbers(item.zh), ...extractNumbers(item.en)])
        expect(new Set(item.numbers)).toEqual(expected)
      }
    }
  })

  it('项目关键词那条标签串**不进**自我介绍', () => {
    // `model.ts` 把技术关键词渲染成一条 `推荐系统 · 协同过滤`。它是为 ATS 的
    // 子串匹配拼的，不是一句话；念出来是「At Campus Marketplace Recommender,
    // I 推荐系统 · 协同过滤.」。所以它单独成字段，事实源不取它。
    const texts = CAMPUS_PLAIN.facts.map((item) => `${item.zh}\n${item.en}`).join('\n')
    expect(texts).not.toContain('推荐系统 · 协同过滤')
    expect(texts).not.toContain('协同过滤')
  })

  it('主标题分隔符契约：职位名被拆对了', () => {
    // `facts.ts` 按 `' · '` 拆 `公司 · 职位`。`model.ts` 改了分隔符而这里没改，
    // 结果是「职位名变成整条标题」—— 读得通、不报错、内容错。
    const work = CAMPUS_PLAIN.facts.find((item) => item.id === 'work.0.0')
    expect(work?.zh).toContain('算法工程实习生')
    expect(work?.en).toContain('Algorithm Engineering Intern')
  })

  it('学历事实带上了起止日期（它是这条事实唯一的数字来源）', () => {
    const education = CAMPUS_PLAIN.facts.find((item) => item.id === 'education.0.heading')
    expect(education?.zh).toContain('2022.09')
    expect(education?.zh).toContain('2026.06')
    expect(education?.en).toContain('2022.09')
  })

  it('没跑英文改写时，要点事实的英文侧被标成中文回退', () => {
    const flagged = CAMPUS_PLAIN.facts.filter((item) => item.zhFallback).map((item) => item.id)
    expect(flagged).toContain('work.0.0')
    expect(flagged).toContain('work.0.1')
    expect(flagged).toContain('projects.0.0')
    // 身份、学历、技能都不是「回退」：它们的两种语言各自独立。
    expect(flagged).not.toContain('identity')
    expect(flagged).not.toContain('education.0.heading')
    expect(flagged).not.toContain('summary')
  })

  it('跑了英文改写之后，被改写的那一条不再被标成回退', () => {
    const flagged = CAMPUS_REWRITTEN.facts.filter((item) => item.zhFallback).map((item) => item.id)
    expect(flagged).not.toContain('work.0.0')
    expect(flagged).not.toContain('work.0.1')
    // 项目那一条没有英文改写产物，所以它仍然是回退 —— 这一格正是
    // 「同一批事实里，哪些英文侧写了、哪些没写」的分辨率。
    expect(flagged).toContain('projects.0.0')
  })

  it('事实源是纯函数：同样的输入给同样的输出', () => {
    const again = buildIntroViews(campusArchiveV1, {
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    expect(again.facts).toEqual(CAMPUS_PLAIN.facts)
  })

  it('事实源不随档位变化 —— 三档拿到的就是同一批事实', () => {
    const only = buildIntroViews(campusArchiveV1, {
      targets: ['intro_zh@60s'],
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    const all = buildIntroViews(campusArchiveV1, {
      targets: INTRO_TARGET_NAMES,
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    expect(only.facts).toEqual(all.facts)
  })
})

// --------------------------------------------------------------------- 合成器

describe('合成器', () => {
  it('三档的 factIds 是同一序列的子集，且各自保持顺序', () => {
    const order = CAMPUS_PLAIN.facts.map((item) => item.id)
    const positions = new Map(order.map((id, index) => [id, index]))
    for (const view of CAMPUS_PLAIN.views) {
      const indexes = view.factIds.map((id) => positions.get(id) ?? -1)
      expect(indexes).not.toContain(-1)
      expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
    }
  })

  it('三档共用的 id 是一致的（同一批事实，不是各自重取的）', () => {
    const zh60 = new Set(viewOf(CAMPUS_PLAIN, 'intro_zh@60s').factIds)
    const en60 = new Set(viewOf(CAMPUS_PLAIN, 'intro_en@60s').factIds)
    const en200 = new Set(viewOf(CAMPUS_PLAIN, 'intro_en@200w').factIds)
    const all = new Set([...zh60, ...en60, ...en200])
    for (const id of all) expect(positionsConsistent([zh60, en60, en200], id)).toBe(true)
  })

  it('视图对外报的 units 是从最终文本重算的，与选择时的累加值相等', () => {
    for (const pkg of [CAMPUS_PLAIN, CAMPUS_REWRITTEN, MAXIMAL]) {
      for (const view of pkg.views) {
        expect(view.units).toBe(introUnits(view.text, view.target.lang))
      }
    }
  })

  it('text 是收进来的句子按顺序相接', () => {
    for (const view of CAMPUS_PLAIN.views) {
      expect(view.sentences.length).toBeGreaterThan(0)
      for (const sentence of view.sentences) expect(view.text).toContain(sentence)
    }
  })

  it('带数字的事实同进同出 —— 一侧装不下时两种语言都不收', () => {
    // 第三条**英文侧装得下、中文侧装不下**。带数字的事实因此两侧都不收 ——
    // 这正是「同进同出」这四个字唯一能被观察到的地方：若它们各自决定，
    // 这一条会出现在英文档里，而它的数字在中文档里没有。
    const facts = factsOf([
      IDENTITY,
      ['work.0.0', 'experience', FILLER_ZH, FILLER_EN],
      [
        'work.0.1',
        'experience',
        `把耗时从 4.2 小时降到 38 分钟。${filler('长', 240)}`,
        'Cut it from 4.2 hours to 38 minutes.',
      ],
    ])
    const pair = composeIntroPair(
      facts,
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    expect(pair.zh?.factIds).not.toContain('work.0.1')
    expect(pair.en?.factIds).not.toContain('work.0.1')
    expect(pair.zh?.skipped.map((item) => item.id)).toContain('work.0.1')
    expect(pair.en?.skipped.map((item) => item.id)).toContain('work.0.1')
  })

  it('不带数字的事实允许两边不对称 —— 这是「英版别被中文拖住」的唯一手段', () => {
    // 中文长、英文短：中文装不下、英文装得下。它没有数字，所以不触发同进同出。
    const facts = factsOf([
      IDENTITY,
      ['work.0.0', 'experience', filler(FILLER_ZH, 10), FILLER_EN],
    ])
    const pair = composeIntroPair(
      facts,
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    expect(pair.zh?.factIds).not.toContain('work.0.0')
    expect(pair.en?.factIds).toContain('work.0.0')
  })

  it('身份必收：即使超上限也收，然后由 intro_too_long 报出来', () => {
    const facts = factsOf([
      ['identity', 'identity', filler('我', 400), filler('I ', 200)],
    ])
    const pair = composeIntroPair(
      facts,
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    const check = checkIntros({
      views: viewsOf(pair),
      pairs: [pair],
      resumeTexts: { zh: [pair.zh?.text ?? ''], en: [pair.en?.text ?? ''] },
    })
    expect(check.pass).toBe(false)
    expect(check.findings.map((finding) => finding.reason)).toContain('intro_too_long')
    expect(pair.zh?.skipped).toHaveLength(0)
  })

  it('跳过项带上「差多少」，因为用户要拿它决定拆哪条要点', () => {
    const facts = factsOf([
      IDENTITY,
      ['work.0.0', 'experience', filler('长', 300), filler('long ', 200)],
    ])
    const pair = composeIntroPair(
      facts,
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    const skip = pair.zh?.skipped[0]
    expect(skip?.need).toBeGreaterThan(0)
    expect(skip?.remaining).toBeLessThan(skip?.need ?? 0)
    expect(skip?.reason).toBe('no_room')
  })

  it('一侧为 null 时不产出那一侧 —— 这是未配对档的实现方式', () => {
    const facts = factsOf([IDENTITY])
    const pair = composeIntroPair(facts, '200w', null, INTRO_TARGETS['intro_en@200w'])
    expect(pair.zh).toBeNull()
    expect(pair.en?.target.name).toBe('intro_en@200w')
  })
})

/** 一组 id 是否在所有集合里同进同出。 */
function positionsConsistent(sets: readonly ReadonlySet<string>[], id: string): boolean {
  return sets.every((set) => set.has(id) === sets[0]?.has(id))
}

function viewsOf(pair: IntroPair): readonly IntroView[] {
  return [pair.zh, pair.en].filter((view): view is IntroView => view !== null)
}

// -------------------------------------------------------------------- 校验器

describe('校验器（T4d 第二条勾）', () => {
  it('默认三档的结论：三档都短，`intro_en@200w` 没有被两两比对过', () => {
    // 这是**真实结论**，不是本用例想看到的东西。它对的原因写在
    // `targets.ts` 的「已知问题」里：同一批事实在中英两档下填到的比例差得很远。
    // 一旦常数问题拍板，这里会变 —— 那时这条断言会红，而那是它该做的事。
    expect(reasonsOf(CAMPUS_PLAIN)).toEqual([
      'intro_too_short',
      'intro_too_short',
      'intro_too_short',
    ])
    expect([...CAMPUS_PLAIN.check.unpaired]).toEqual(['intro_en@200w'])
  })

  it('三档之外没有别的失败 —— 数字一条都没编、没有跨语言不一致、没超页', () => {
    for (const pkg of [CAMPUS_PLAIN, CAMPUS_REWRITTEN, MAXIMAL]) {
      const reasons = reasonsOf(pkg)
      expect(reasons).not.toContain('intro_unsupported_number')
      expect(reasons).not.toContain('intro_cross_language_mismatch')
      expect(reasons).not.toContain('intro_too_long')
    }
  })

  it('中英两档数字集合相等（带数字的事实同进同出的直接结果）', () => {
    for (const pkg of [CAMPUS_PLAIN, CAMPUS_REWRITTEN, MAXIMAL]) {
      for (const pair of pkg.pairs) {
        if (pair.zh === null || pair.en === null) continue
        expect(new Set(extractNumbers(pair.en.text))).toEqual(new Set(extractNumbers(pair.zh.text)))
      }
    }
  })

  it('未配对档确实没有跨语言比较 —— 三档不是「都过了跨语言校验」', () => {
    expect(CAMPUS_PLAIN.check.unpaired).toHaveLength(1)
    expect(CAMPUS_PLAIN.check.unpaired).not.toContain('intro_zh@60s')
    expect(CAMPUS_PLAIN.check.unpaired).not.toContain('intro_en@60s')
  })

  it('反向验证：把简历文本行清空，每一个数字都会变成「简历上没有」', () => {
    // 这条同时是那个真实 bug 的回归测试。第一版把 `PackageView.texts`
    // （一行行正文）当成了数字集合，于是拿数字去 `Set.has` 整行文本，
    // 恒不命中 —— 三档全红。这条断言把「比较真的在跑」和「比较的是什么」
    // 一起钉住：喂空文本行，它必须红；喂真文本行，它必须绿。
    const empty = checkIntros({
      views: [...CAMPUS_PLAIN.views],
      pairs: [...CAMPUS_PLAIN.pairs],
      resumeTexts: { zh: [], en: [] },
    })
    expect(empty.findings.map((finding) => finding.reason)).toContain('intro_unsupported_number')

    const real = checkIntros({
      views: [...CAMPUS_PLAIN.views],
      pairs: [...CAMPUS_PLAIN.pairs],
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    expect(real.findings.map((finding) => finding.reason)).not.toContain(
      'intro_unsupported_number',
    )
  })

  it('反向验证：自述里编一个新数字 ⇒ intro_unsupported_number 必须红', () => {
    const view = viewOf(CAMPUS_PLAIN, 'intro_zh@60s')
    const tampered: IntroView = {
      ...view,
      text: `${view.text}一共投递了 987654 份简历。`,
      sentences: [...view.sentences, '一共投递了 987654 份简历。'],
    }
    const check = checkIntros({
      views: [tampered],
      pairs: [{ key: '60s', zh: tampered, en: null }],
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    const finding = check.findings.find(
      (item) => item.reason === 'intro_unsupported_number',
    )
    expect(finding).toBeDefined()
    expect(finding?.severity).toBe('fatal')
    expect(check.pass).toBe(false)
    // 失败要落到句子上，不能只报一个数字。
    expect(finding?.detail).toContain('987654')
  })

  it('反向验证：中英两档数字不一致 ⇒ intro_cross_language_mismatch 必须红', () => {
    const zh = viewOf(CAMPUS_PLAIN, 'intro_zh@60s')
    const en = viewOf(CAMPUS_PLAIN, 'intro_en@60s')
    const drifted: IntroView = { ...en, text: en.text.replace('12', '13') }
    const check = checkIntros({
      views: [zh, drifted],
      pairs: [{ key: '60s', zh, en: drifted }],
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    const finding = check.findings.find(
      (item) => item.reason === 'intro_cross_language_mismatch',
    )
    expect(finding?.severity).toBe('fatal')
    expect(finding?.offending).toContain('13')
    expect(finding?.offending).toContain('12')
  })

  it('target 层不参与 pass：英文口播句太长时不阻断交付', () => {
    // 六句各 27 词：总长落在 60 秒档的带内（135–165），而每句都超过 25 词。
    // 于是「字数」全是绿的、「可朗读性」是红的 —— 这正是要区分开的那种情形。
    const sentence =
      'I studied computer science at a university where I focused on recommender systems and feature engineering and offline to online metric loops for a long time now.'
    const sentences = Array.from({ length: 6 }, () => sentence)
    const text = sentences.join(' ')
    const view: IntroView = {
      target: INTRO_TARGETS['intro_en@60s'],
      text,
      sentences,
      units: introUnits(text, 'en'),
      factIds: ['identity'],
      zhFallbackFactIds: [],
      skipped: [],
    }
    expect(view.units).toBeGreaterThanOrEqual(view.target.minUnits)
    expect(view.units).toBeLessThanOrEqual(view.target.maxUnits)
    expect(averageSentenceLength(text, 'en')).toBeGreaterThan(MAX_SPOKEN_SENTENCE_WORDS)

    const check = checkIntros({
      views: [view],
      pairs: [{ key: '60s', zh: null, en: view }],
      resumeTexts: { zh: [], en: [text] },
    })
    expect(check.findings.map((finding) => finding.reason)).toContain(
      'intro_sentence_too_long',
    )
    expect(check.findings.every((finding) => finding.severity === 'target')).toBe(true)
    // 唯一一条判据是优化目标 ⇒ 交付放行。把优化目标算进 pass 会让用户
    // 为了过一条不该拦他的检查去删掉真实内容。
    expect(check.pass).toBe(true)
  })

  it('档位可以落在带内：足够长的事实源 ⇒ 没有字数类失败', () => {
    const specs = Array.from({ length: 4 }, (_, index) => [
      `work.0.${index}`,
      'experience',
      filler(FILLER_ZH, 2),
      filler(FILLER_EN, 3),
    ]) as readonly (readonly [string, IntroFactKind, string, string])[]
    const pair = composeIntroPair(
      factsOf([IDENTITY, ...specs]),
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    const check = checkIntros({
      views: viewsOf(pair),
      pairs: [pair],
      resumeTexts: { zh: [pair.zh?.text ?? ''], en: [pair.en?.text ?? ''] },
    })
    for (const view of viewsOf(pair)) {
      expect(view.units).toBeGreaterThanOrEqual(view.target.minUnits)
      expect(view.units).toBeLessThanOrEqual(view.target.maxUnits)
    }
    expect(check.findings.map((finding) => finding.reason)).not.toContain('intro_too_short')
    expect(check.findings.map((finding) => finding.reason)).not.toContain('intro_too_long')
  })

  it('档位不足时是 hard，且 pass 为假', () => {
    const facts = factsOf([IDENTITY])
    const pair = composeIntroPair(
      facts,
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    const check = checkIntros({
      views: viewsOf(pair),
      pairs: [pair],
      resumeTexts: { zh: [pair.zh?.text ?? ''], en: [pair.en?.text ?? ''] },
    })
    const finding = check.findings.find((item) => item.reason === 'intro_too_short')
    expect(finding?.severity).toBe('hard')
    expect(check.pass).toBe(false)
  })

  it('失败详情指出最便宜的那条修法：先跑英文改写，不是补档案', () => {
    const finding = CAMPUS_PLAIN.check.findings.find(
      (item) => item.reason === 'intro_too_short' && item.offending.includes('135'),
    )
    expect(finding?.detail).toContain('英文改写')
    expect(finding?.detail).toContain('work.0.0')
  })

  it('没有中文回退、也没有跳过项时，详情指向换算问题而不是「去补档案」', () => {
    // 中文侧填满、英文侧远不足，且所有事实都收下了 —— 这时「补档案」是错的建议，
    // 因为补进去的还是中文。判据是**覆盖率之差**，不是「同档是否落进档内」：
    // 「同档达标了吗」在两边都不足时给出同一种答案，会把两种成因归成一类。
    const pair = composeIntroPair(
      factsOf([
        IDENTITY,
        ['work.0.0', 'experience', `${FILLER_ZH}${filler(FILLER_ZH, 2)}`, FILLER_EN],
        ['work.0.1', 'experience', `${FILLER_ZH}${filler(FILLER_ZH, 2)}`, FILLER_EN],
        ['work.0.2', 'experience', `${FILLER_ZH}${filler(FILLER_ZH, 2)}`, FILLER_EN],
      ]),
      '60s',
      INTRO_TARGETS['intro_zh@60s'],
      INTRO_TARGETS['intro_en@60s'],
    )
    const check = checkIntros({
      views: viewsOf(pair),
      pairs: [pair],
      resumeTexts: { zh: [pair.zh?.text ?? ''], en: [pair.en?.text ?? ''] },
    })
    const finding = check.findings.find(
      (item) => item.reason === 'intro_too_short' && item.offending.includes('135'),
    )
    expect(finding?.detail).toContain('已知问题')
    expect(finding?.detail).toContain('不该由你去补内容')
    expect(finding?.detail).not.toContain('英文改写')
  })
})

// ------------------------------------------------------------------- 入口

describe('buildIntroViews', () => {
  it('默认产出三档，且顺序按请求', () => {
    expect(CAMPUS_PLAIN.views.map((view) => view.target.name)).toEqual([
      ...DEFAULT_INTRO_TARGETS,
    ])
  })

  it('只要一档时不会多产出别的档', () => {
    const single = buildIntroViews(campusArchiveV1, {
      targets: ['intro_en@200w'],
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    expect(single.views.map((view) => view.target.name)).toEqual(['intro_en@200w'])
    expect(single.pairs).toHaveLength(1)
    expect(single.pairs[0]?.zh).toBeNull()
  })

  it('同一档位键的中英两档在一次合成里配对', () => {
    const pair = CAMPUS_PLAIN.pairs.find((item) => item.key === '60s')
    expect(pair?.zh?.target.name).toBe('intro_zh@60s')
    expect(pair?.en?.target.name).toBe('intro_en@60s')
  })

  it('`resumeTexts` 不是可选项 —— 省略即静默少一条判据', () => {
    // @ts-expect-error 省略 `resumeTexts` 必须编不过
    const build = () => buildIntroViews(campusArchiveV1, {})
    expect(build).toBeDefined()
  })

  it('事实源与档位无关，但视图随档位变', () => {
    const only = buildIntroViews(campusArchiveV1, {
      targets: ['intro_en@200w'],
      resumeTexts: resumeTextsOf(CAMPUS_PLAIN_PKG),
    })
    expect(only.facts).toEqual(CAMPUS_PLAIN.facts)
    expect(only.views[0]?.factIds).toEqual(viewOf(CAMPUS_PLAIN, 'intro_en@200w').factIds)
  })
})

// ------------------------------------------------------------- 校准温度计

describe('校准温度计（不服务于验收，服务于下一次调试）', () => {
  it('记录当前三档长度 —— 不是判据，是让改动可见', () => {
    // 改动切句、模板、白名单或样本档案时，这几个数会变。
    // 变了**不代表错了**，代表「连着 `targets.ts` 的「已知问题」一起再看一遍」。
    expect(viewOf(CAMPUS_PLAIN, 'intro_zh@60s').units).toBe(211)
    expect(viewOf(CAMPUS_PLAIN, 'intro_en@60s').units).toBe(65)
    expect(viewOf(CAMPUS_PLAIN, 'intro_en@200w').units).toBe(65)
    expect(viewOf(MAXIMAL, 'intro_zh@60s').units).toBe(214)
    expect(viewOf(MAXIMAL, 'intro_en@60s').units).toBe(64)
  })

  it('同一批事实：中文档填到 87%，英文档填到 53%', () => {
    // 这两个数是 `targets.ts` 那条「1 汉字 ≈ 0.6 英语单词」假设的实测反面。
    // 已拍板（见 `targets.ts` 2026-09-19 注记）：缺口按**内容问题**处置，
    // 语速常数 {4.0, 2.5} 不动 —— 这两个数差 30 多个百分点，调常数救不了
    // （即使按忠实的 0.6 折算，209 字也只有 125 词，仍低于档下限 135）。
    // 它们**不是我想要的数**，而是当前的事实。改动切句、模板、语速常数、
    // 或样本档案时，这一格会动 —— 那时请连着 `targets.ts` 的注释一起看。
    const zh = viewOf(CAMPUS_REWRITTEN, 'intro_zh@60s')
    const en = viewOf(CAMPUS_REWRITTEN, 'intro_en@60s')
    const zhCoverage = zh.units / zh.target.units
    const enCoverage = en.units / en.target.units
    expect(zhCoverage).toBeGreaterThan(0.85)
    expect(zhCoverage).toBeLessThan(0.95)
    expect(enCoverage).toBeGreaterThan(0.45)
    expect(enCoverage).toBeLessThan(0.6)
    // 两种语言的覆盖差 30 多个百分点 —— 这不是模板笔误能解释的量级。
    expect(zhCoverage - enCoverage).toBeGreaterThan(0.25)
  })

  it('同一批事实、两种语言，词字比远低于 0.6', () => {
    // 0.38 量的是**本项目渲染产物的内容密度**，不是翻译密度 —— 它被
    // 「英版允许删非数字事实」（DESIGN 10.2）污染，且 n=1。
    // **永远不要拿它当换算常数用**；钉住它只为让渲染密度的漂移可见。
    const zh = viewOf(CAMPUS_REWRITTEN, 'intro_zh@60s')
    const en = viewOf(CAMPUS_REWRITTEN, 'intro_en@60s')
    const ratio = en.units / zh.units
    expect(ratio).toBeGreaterThan(0.35)
    expect(ratio).toBeLessThan(0.45)
  })

  it('英文侧的数字被当成了词，所以英文的长度口径并不保守', () => {
    // 这一点写下来是为了让下一个调常数的人知道：`intro_en@60s` 的 89 词里
    // 有 8 个「词」其实是 `2022.09` / `4.2` 这类数字切出来的。
    const en = viewOf(CAMPUS_REWRITTEN, 'intro_en@60s')
    const digitWords = extractNumbers(en.text).reduce(
      (sum, number) => sum + number.split('.').length,
      0,
    )
    expect(digitWords).toBeGreaterThan(0)
    expect(numberSet(en.text).size).toBeGreaterThan(0)
  })
})
