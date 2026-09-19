import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import { textsParity } from '../verify/parity'
import { campusArchiveV1, campusRewritten } from './__fixtures__/campus-archive'
import { lineOf } from './ats'
import { VIEW_SUFFIXES, checkFileNames, isDeliveryFileName } from './filename'
import { scanForbiddenLayout } from './format'
import { CAMPUS_LAYOUT } from './layout'
import {
  buildDeliveryPackage,
  checkPackage,
  type DeliveryPackageViews,
  type PackageView,
} from './package'
import { bodyLinePt } from './paginate'

/** 一个形状完全合规、数字也正确的投递包 —— 所有反向验证的基准。 */
const CLEAN = buildDeliveryPackage(campusArchiveV1, { rewritten: campusRewritten })

const NUMBER_PATTERN = /\d+(?:[.,]\d+)*/g

/**
 * 把英版的某个数字换成哨兵值。
 *
 * 哨兵必须是一个**原本不存在的数字**：如果换成另一个已经出现过的数字，
 * 集合比较仍然可能相等，于是「篡改必须失败」这条断言会因为巧合而通过 ——
 * 那是一条假断言。987654 在原样本里一处都没有。
 */
const TAMPER = '987654'

function tamperEachNumber(
  texts: readonly string[],
  replacement: string,
): readonly (readonly string[])[] {
  const variants: (readonly string[])[] = []
  for (let lineIndex = 0; lineIndex < texts.length; lineIndex += 1) {
    const line = texts[lineIndex] ?? ''
    const occurrences = [...line.matchAll(/\d+(?:[.,]\d+)*/g)].length
    for (let target = 0; target < occurrences; target += 1) {
      let seen = 0
      const replaced = line.replace(NUMBER_PATTERN, (match) => {
        const mine = seen === target
        seen += 1
        return mine ? replacement : match
      })
      if (replaced === line) continue
      variants.push(texts.map((text, index) => (index === lineIndex ? replaced : text)))
    }
  }
  return variants
}

function withEn(view: PackageView, texts: readonly string[]): PackageView {
  return { ...view, texts }
}

function tampered(views: DeliveryPackageViews, enTexts: readonly string[]): DeliveryPackageViews {
  return { ...views, en: withEn(views.en, enTexts) }
}

describe('T4b · 三版一次产出', () => {
  it('三份视图的名字与顺序固定：CN → EN → 双语', () => {
    // 顺序是产物的一部分，不是调用方的口味 —— T4c 会把它变成文件名前缀。
    expect([CLEAN.views.cn.name, CLEAN.views.en.name, CLEAN.views.bilingual.name]).toEqual([
      'Resume_CN',
      'Resume_EN',
      'Resume_Bilingual',
    ])
  })

  it('中版用中文语种与中文节标题，英版用英文', () => {
    expect(CLEAN.views.cn.texts).toContain('教育背景')
    expect(CLEAN.views.cn.texts.join('\n')).toContain('林知远')
    expect(CLEAN.views.en.texts).toContain('Education')
    expect(CLEAN.views.en.texts).not.toContain('教育背景')
  })

  it('一次调用就产出三份 HTML，且三份都不缺 B 级数据', () => {
    // 与 `core/egress` 恰好相反的那条线：同一个手机号在那边断言「绝不出网」，
    // 在这边断言「三份产物里都必须有」。
    for (const view of [CLEAN.views.cn, CLEAN.views.en, CLEAN.views.bilingual]) {
      expect(view.html).toContain('+8613800138000')
      expect(view.texts.join('\n')).toContain('linzhiyuan@example.com')
    }
  })

  it('双语版是**一份**文档 —— 不是两份 HTML 首尾相接', () => {
    const html = CLEAN.views.bilingual.html
    expect(html.match(/<html\b/g)?.length).toBe(1)
    expect(html.match(/<body\b/g)?.length).toBe(1)
    expect(html.match(/<head\b/g)?.length).toBe(1)
  })

  it('双语版两半各带自己的 lang，且断页在**后半**上', () => {
    const html = CLEAN.views.bilingual.html
    // 根节点只能声明一种语言；中文半页不带 lang 标记会让屏幕阅读器与
    // 拼写检查按英文规则读中文，也会让 ATS 的语种判定出错。
    expect(html).toContain('class="half" lang="en"')
    expect(html).toContain('class="half page-break" lang="zh-CN"')
    // 断页挂在后半而不是文档末尾：以断页属性结尾时，部分渲染引擎会多吐一张空白页。
    expect(html.indexOf('class="half" lang="en"')).toBeLessThan(
      html.indexOf('class="half page-break"'),
    )
  })

  it('双语版的文本 = 英版 ++ 中版，逐字相同且顺序如此', () => {
    const prefix = CLEAN.views.bilingual.texts.slice(0, CLEAN.views.en.texts.length)
    expect(prefix).toEqual([...CLEAN.views.en.texts])
    const suffix = CLEAN.views.bilingual.texts.slice(CLEAN.views.en.texts.length)
    expect(suffix).toEqual([...CLEAN.views.cn.texts])
  })

  it('双语版不排序不合并：中英两半的条数各自完整', () => {
    expect(CLEAN.views.bilingual.texts.length).toBe(
      CLEAN.views.cn.texts.length + CLEAN.views.en.texts.length,
    )
  })

  it('产出是纯函数：同一档案两次调用逐字相同', () => {
    expect(buildDeliveryPackage(campusArchiveV1, { rewritten: campusRewritten })).toEqual(CLEAN)
  })
})

describe('T4b · 跨语言数字集合相等（DESIGN 10.2）', () => {
  it('中英两版的数字集合完全相等', () => {
    const report = textsParity(CLEAN.views.cn.texts, CLEAN.views.en.texts)
    expect(report.onlyInLeft).toEqual([])
    expect(report.onlyInRight).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('**这次相等是校验出来的，不是凑巧的**：两侧确实各有独立的文本与数字', () => {
    const parity = CLEAN.check.parity
    expect(parity.status).toBe('consistent')
    // 这一条是上面那条的全部价值所在。英版的要点来自英文改写调用、
    // 中版的要点来自中文改写调用，两者互不相关 —— 所以「数字相等」
    // 是一个可能不成立的结论，而不是构造上的必然。
    expect(parity.independentCn.length).toBeGreaterThan(0)
    expect(parity.independentCn).toEqual(parity.independentEn)
    expect(parity.independentEn).toEqual(['4.2', '12', '38', '8613800138000'])
    expect(parity.bulletsFromSharedSource).toBe(false)
  })

  it('手机号也在校验范围内 —— 两次渲染虽弱，但确实独立', () => {
    // 中版写「电话：+8613…」、英版写「Phone: +8613…」，两行文本不同，
    // 于是这个号码落在「独立数字」里。它不是雕花：英版里把号码打错一位，
    // 会被这条校验抓到，而那是肉眼最难发现的一类错。
    expect(CLEAN.check.parity.independentEn).toContain('8613800138000')
  })

  it('两侧有大量逐字相同的文本（时间、GPA、语言分数）', () => {
    // 共享文本不是缺陷 —— 这些字段本来就该两侧一样。记下它是因为
    // 「独立数字」这个判据就是按它算的：落在共享文本上的数字，
    // 比较它们等于比较两个恒等集合。
    expect(CLEAN.check.parity.sharedTexts).toBeGreaterThan(5)
  })

  it('**两侧要点逐字相同时，不许把它说成「已核对」**', () => {
    // 没跑英文改写 ⇒ 两版要点逐字相同 ⇒ 要点里的数字相等是构造性的。
    // 关键在于：它**不是失败**（档案没问题，缺的是一个动作），
    // 但也**不能**被说成「跨语言一致性已通过」—— 界面上必须分开说，
    // 否则用户会以为自己得到了一层在他做英文改写之前并不存在的保护。
    const plain = buildDeliveryPackage(campusArchiveV1)
    expect(plain.check.parity.status).toBe('consistent')
    expect(plain.check.parity.bulletsFromSharedSource).toBe(true)
    expect(plain.check.pass).toBe(true)
    expect(plain.check.failures).toEqual([])
    // 而跑过英文改写之后，同一份档案的这个标记必须翻过来。
    expect(CLEAN.check.parity.bulletsFromSharedSource).toBe(false)
  })

  it('满档案同样被如实标记为「要点未独立改写」', () => {
    // 一份真实两页、中英各一版的档案，要点全部来自同一个 `highlights` 数组。
    const maximal = buildDeliveryPackage(maximalArchiveV1)
    expect(maximal.check.parity.bulletsFromSharedSource).toBe(true)
  })
})

describe('T4b · 篡改英版任意一个数字 ⇒ 校验必须失败', () => {
  const sites = tamperEachNumber(CLEAN.views.en.texts, TAMPER)

  it('篡改位点足够多 —— 否则下面那条循环是空转的', () => {
    // 一条 `for` 循环里没有元素时会「通过」。这是 T1.4 那次
    // 「无法与『测试根本没在跑』区分的绿，不算绿」的又一次应用。
    expect(sites.length).toBeGreaterThanOrEqual(12)
  })

  it('**每一个**数字位点被篡改后都必须失败，且理由是数字不一致', () => {
    const survivors: string[] = []
    for (const texts of sites) {
      const check = checkPackage(tampered(CLEAN.views, texts))
      const mismatch = check.failures.find(
        (failure) => failure.reason === 'cross_language_mismatch',
      )
      if (check.pass || mismatch === undefined || !mismatch.offending.includes(TAMPER)) {
        survivors.push(texts.find((text) => text.includes(TAMPER)) ?? '(未知)')
      }
    }
    expect(survivors).toEqual([])
  })

  it('失败的 detail 指得出**是哪一行** —— 只说「数字 6 不一致」等于没有报错', () => {
    const texts = sites.find((variant) => variant.some((text) => text.includes(TAMPER)))
    expect(texts).toBeDefined()
    const check = checkPackage(tampered(CLEAN.views, texts ?? []))
    const failure = check.failures.find((item) => item.reason === 'cross_language_mismatch')
    expect(failure?.detail).toContain(TAMPER)
    // 报错里出现的必须是原始行文本，用户照着它就能改。
    expect(failure?.detail).toContain('「')
    expect(failure?.severity).toBe('fatal')
  })

  it('未篡改的基准是绿的 —— 上面那组「必须失败」才有意义', () => {
    expect(CLEAN.check.pass).toBe(true)
    expect(CLEAN.check.failures).toEqual([])
  })
})

describe('T4b · 双语版的完整性由它自己守，不由两两数字相等守', () => {
  it('**双语版只剩英版一半时，两两数字相等仍然全绿**', () => {
    // 这条断言是「双语版不进两两比较」这个决定的全部依据。
    // 若把双语版放进 pairwise，得到的是一个看起来覆盖了拼页完整性、
    // 实际什么也没覆盖的检查 —— 下面第一段就是它的反例。
    const broken: DeliveryPackageViews = {
      ...CLEAN.views,
      bilingual: withEn(CLEAN.views.bilingual, CLEAN.views.en.texts),
    }

    const pairwise = [
      textsParity(broken.cn.texts, broken.en.texts),
      textsParity(broken.cn.texts, broken.bilingual.texts),
      textsParity(broken.en.texts, broken.bilingual.texts),
    ]
    expect(pairwise.every((report) => report.ok)).toBe(true)

    // 而真正守着这件事的那条检查必须红。
    const check = checkPackage(broken)
    expect(check.pass).toBe(false)
    expect(check.failures.map((failure) => failure.reason)).toContain('bilingual_incomplete')
  })

  it('双语缺行时报出缺了哪些行与缺几行', () => {
    const broken: DeliveryPackageViews = {
      ...CLEAN.views,
      bilingual: withEn(CLEAN.views.bilingual, CLEAN.views.cn.texts),
    }
    const check = checkPackage(broken)
    const failure = check.failures.find((item) => item.reason === 'bilingual_incomplete')
    expect(failure?.detail).toContain('双语版缺了')
    expect(failure?.offending).not.toBe('')
  })

  it('顺序倒置（中版在前）会被单独报出来', () => {
    const reversed: DeliveryPackageViews = {
      ...CLEAN.views,
      bilingual: withEn(CLEAN.views.bilingual, [
        ...CLEAN.views.cn.texts,
        ...CLEAN.views.en.texts,
      ]),
    }
    const check = checkPackage(reversed)
    expect(check.failures.map((failure) => failure.reason)).toContain('bilingual_en_not_first')
    // 行是全的，所以缺行那条不该跟着响 —— 两个失败对应两件不同的处置。
    expect(check.failures.map((failure) => failure.reason)).not.toContain('bilingual_incomplete')
  })
})

describe('T4b · 英版严格一页', () => {
  it('校招样本的英版恰好一页，且留有余量', () => {
    expect(CLEAN.views.en.pages.pages).toBe(1)
    expect(CLEAN.views.en.pages.fitsOnePage).toBe(true)
    expect(CLEAN.views.en.pages.overflowPt).toBe(0)
    // 有富余，但富余不能太大 —— 一个「怎么塞都放得下」的估算器
    // 会让这条断言恒真。余量上界取 8 行：再多，说明样本离真实边界太远，
    // 这条断言也就不再在测边界，而在测一个空文档。
    expect(CLEAN.views.en.pages.slackPt).toBeGreaterThan(0)
    expect(CLEAN.views.en.pages.slackPt).toBeLessThan(8 * bodyLinePt(CAMPUS_LAYOUT))
  })

  it('**超页判失败**，且给出该删哪一段', () => {
    const over = buildDeliveryPackage(maximalArchiveV1)
    const failure = over.check.failures.find((item) => item.reason === 'en_over_one_page')
    expect(failure).toBeDefined()
    expect(over.views.en.pages.pages).toBeGreaterThanOrEqual(2)
    expect(over.check.pass).toBe(false)
    // 「超出 62pt」对用户没有任何指导意义，「要点 372pt / 节标题 216pt」才有。
    expect(failure?.detail).toMatch(/要点 \d+pt/)
    expect(failure?.detail).toContain('一页')
  })

  it('中文版不设页数上限 —— 把英美的规范套到中文简历上正是 10.1 反对的方向', () => {
    // 满档案的中版必然超过一页，而它不该因此产生任何失败。
    const over = buildDeliveryPackage(maximalArchiveV1)
    expect(over.views.cn.pages.pages).toBeGreaterThan(1)
    expect(over.views.cn.pages.fitsOnePage).toBe(false)

    // 超页失败只能有一条，且它说的必须是**英版**的页数 ——
    // 否则「中版不受限」这条断言在「失败信息其实在说中版」时也会通过。
    const pageFailures = over.check.failures.filter(
      (failure) => failure.reason === 'en_over_one_page',
    )
    expect(pageFailures.length).toBe(1)
    expect(pageFailures[0]?.offending).toContain(`${over.views.en.pages.pages} 页`)
  })

  it('双语版的页数是两半之和（各自从新页开始）', () => {
    expect(CLEAN.views.bilingual.pages.pages).toBe(
      CLEAN.views.en.pages.pages + CLEAN.views.cn.pages.pages,
    )
    const over = buildDeliveryPackage(maximalArchiveV1)
    expect(over.views.bilingual.pages.pages).toBe(
      over.views.en.pages.pages + over.views.cn.pages.pages,
    )
  })
})

describe('T4b · 教育段在英版中位于实习经历之前', () => {
  it('抽出文本后，学校行在第一条经历之前', () => {
    const lines = CLEAN.views.en.texts
    const education = lineOf(lines, '某某大学')
    const work = lineOf(lines, '杭州某某科技有限公司')
    expect(education).toBeGreaterThanOrEqual(0)
    expect(work).toBeGreaterThan(education)
  })

  it('节标题的顺序也是 Education 在 Experience 之前', () => {
    const lines = CLEAN.views.en.texts
    expect(lineOf(lines, 'Education')).toBeLessThan(lineOf(lines, 'Experience'))
  })

  it('中版同样教育前置 —— 两个 target 的目标场景相同（外企校招）', () => {
    const lines = CLEAN.views.cn.texts
    expect(lineOf(lines, '某某大学')).toBeLessThan(lineOf(lines, '杭州某某科技有限公司'))
  })

  it('双语版的后半段（中版）里，教育同样在经历之前', () => {
    const cnHalf = CLEAN.views.bilingual.texts.slice(CLEAN.views.en.texts.length)
    expect(lineOf(cnHalf, '某某大学')).toBeLessThan(lineOf(cnHalf, '杭州某某科技有限公司'))
  })

  it('条目标题与时间行相邻 —— 顺序对了但归属断了，ATS 一样读不出来', () => {
    const lines = CLEAN.views.en.texts
    const workLine = lineOf(lines, '杭州某某科技有限公司')
    expect(lines[workLine + 1]).toContain('2025.06')
  })
})

const THREE_VIEWS = [CLEAN.views.cn, CLEAN.views.en, CLEAN.views.bilingual] as const

function withBilingual(texts: readonly string[]): DeliveryPackageViews {
  return { ...CLEAN.views, bilingual: { ...CLEAN.views.bilingual, texts } }
}

describe('T4c · 文件名规范', () => {
  it('默认文件名就是视图名 + .pdf —— 与 T4b 已经用着的视图名兼容', () => {
    expect(THREE_VIEWS.map((view) => view.fileName)).toEqual([
      'Resume_CN.pdf',
      'Resume_EN.pdf',
      'Resume_Bilingual.pdf',
    ])
    for (const view of THREE_VIEWS) expect(view.fileName).toBe(`${view.name}.pdf`)
  })

  it('视图名的后缀与 `VIEW_SUFFIXES` 一一对应 —— 两处不许各自漂移', () => {
    // `PackageViewName` 是新写的联合类型，`VIEW_SUFFIXES` 是命名模块里的常量。
    // 它们必须描述同一件事，否则「后缀」会在两个文件里各自演化。
    expect(THREE_VIEWS.map((view) => view.name)).toEqual(
      VIEW_SUFFIXES.map((suffix) => `Resume_${suffix}`),
    )
  })

  it('三份文件名全部合规', () => {
    for (const view of THREE_VIEWS) expect(isDeliveryFileName(view.fileName)).toBe(true)
    expect(checkFileNames(THREE_VIEWS)).toEqual([])
  })

  it('自定义词干被净化后拼进文件名，投递包照样通过', () => {
    const named = buildDeliveryPackage(campusArchiveV1, {
      rewritten: campusRewritten,
      fileStem: 'Zhang Zhiyuan',
    })
    expect(named.views.en.fileName).toBe('Zhang_Zhiyuan_EN.pdf')
    expect(named.naming).toEqual({
      requestedStem: 'Zhang Zhiyuan',
      usedStem: 'Zhang_Zhiyuan',
      fellBack: false,
    })
    // 命名不是失败：三份文件都合规，内容也没变。
    expect(named.check.pass).toBe(true)
    expect(named.check.failures).toEqual([])
  })

  it('**全中文词干必须回落，而且必须说出来**', () => {
    // 「张智远」是中文用户命名简历时最自然的一个输入，而它在允许字符集里
    // 一个字符都不剩。这是本任务里最可能真实发生的一种输入。
    const named = buildDeliveryPackage(campusArchiveV1, {
      rewritten: campusRewritten,
      fileStem: '张智远',
    })
    expect(named.naming.fellBack).toBe(true)
    // 原始请求必须保留 —— 界面才能说出「你要的那个名字用不了」，
    // 而不是只给一个自己没选过的 `Resume_CN.pdf`。
    expect(named.naming.requestedStem).toBe('张智远')
    expect(named.views.cn.fileName).toBe('Resume_CN.pdf')
    for (const view of [named.views.cn, named.views.en, named.views.bilingual]) {
      expect(isDeliveryFileName(view.fileName)).toBe(true)
    }
    // 回落**不是**失败：投递包本身没问题。
    expect(named.check.pass).toBe(true)
    expect(named.check.failures).toEqual([])
  })

  it('**坏文件名必须能被抓到**（反向验证）—— 这个检查在实践中到不了，所以要手工喂一次', () => {
    // `sanitizeFileStem` 的契约是「任何输入都产出合规名字」，所以这一条在
    // 真实调用路径上永远不会响。它必须仍然能响，否则它是一条没人验证过的代码。
    const broken: DeliveryPackageViews = {
      ...CLEAN.views,
      en: { ...CLEAN.views.en, fileName: '张智远 简历.pdf' },
    }
    const check = checkPackage(broken)
    const failure = check.failures.find((item) => item.reason === 'invalid_file_name')

    expect(failure).toBeDefined()
    expect(check.pass).toBe(false)
    expect(failure?.severity).toBe('fatal')
    expect(failure?.offending).toBe('张智远 简历.pdf')
    // 报错要指得出**哪一个字符**：只说「文件名不合规」等于没有报错。
    expect(failure?.detail).toContain('第 1 个字符')
    expect(failure?.detail).toContain('张')
  })

  it('全部字符都合法却缺了后缀时，报的是后缀而不是字符', () => {
    const broken: DeliveryPackageViews = {
      ...CLEAN.views,
      cn: { ...CLEAN.views.cn, fileName: 'Resume_CN' },
    }
    const failure = checkPackage(broken).failures.find(
      (item) => item.reason === 'invalid_file_name',
    )
    expect(failure?.detail).toContain('后缀必须是 .pdf')
    expect(failure?.detail).not.toContain('个字符')
  })
})

describe('T4c · 单栏纪律挂到三份产物上', () => {
  it('三份产物的 HTML 都过扫描（T4a 只在单语产物上跑过这件事）', () => {
    for (const view of THREE_VIEWS) {
      expect([view.name, scanForbiddenLayout(view.html)]).toEqual([view.name, []])
    }
  })

  it('**注入分栏样式 ⇒ 必须失败**，且指出是哪一份、哪一条', () => {
    const twoColumn: DeliveryPackageViews = {
      ...CLEAN.views,
      bilingual: {
        ...CLEAN.views.bilingual,
        html: '<style>.half { display: flex; }</style>',
      },
    }
    const check = checkPackage(twoColumn)
    const failure = check.failures.find((item) => item.reason === 'column_layout_detected')

    expect(check.pass).toBe(false)
    expect(failure?.severity).toBe('fatal')
    expect(failure?.offending).toContain('Resume_Bilingual')
    expect(failure?.offending).toContain('display:flex')
    expect(failure?.detail).toContain('阅读顺序')
    // 文本一个字符都没动，所以双语那三条检查一条都不该响 ——
    // 失败必须落在正确的那一条上，否则用户会去改错东西。
    expect(check.failures.map((item) => item.reason)).toEqual(['column_layout_detected'])
  })
})

describe('T4c · 双语版的三条检查互不串台', () => {
  const EN_TEXTS = CLEAN.views.en.texts
  const CN_TEXTS = CLEAN.views.cn.texts

  function reasonsOf(texts: readonly string[]): readonly string[] {
    return checkPackage(withBilingual(texts))
      .failures.filter((failure) => failure.reason.startsWith('bilingual_'))
      .map((failure) => failure.reason)
  }

  it('少拼尾部 ⇒ 只报缺行', () => {
    // 砍**尾部**而不是只留英版：只留英版时顺序也不对，两条会一起响，
    // 那样就测不出「哪条检查管哪件事」了。
    expect(reasonsOf([...EN_TEXTS, ...CN_TEXTS.slice(0, -1)])).toEqual(['bilingual_incomplete'])
  })

  it('中版在前 ⇒ 只报顺序', () => {
    expect(reasonsOf([...CN_TEXTS, ...EN_TEXTS])).toEqual(['bilingual_en_not_first'])
  })

  it('**多出一行 ⇒ 只报「不是逐字拼接」**：T4b 的两条检查此时全绿', () => {
    const reasons = reasonsOf([...EN_TEXTS, ...CN_TEXTS, 'Page 1 of 2'])
    expect(reasons).not.toContain('bilingual_incomplete')
    expect(reasons).not.toContain('bilingual_en_not_first')
    expect(reasons).toEqual(['bilingual_not_sequential'])
  })

  it('后半内部被换过顺序（行数相同、内容相同）⇒ 也只报「不是逐字拼接」', () => {
    const head = CN_TEXTS[0] ?? ''
    const different = CN_TEXTS.findIndex((line) => line !== head)
    expect(different).toBeGreaterThan(0)

    const swapped = [...CN_TEXTS]
    swapped[0] = CN_TEXTS[different] ?? ''
    swapped[different] = head

    expect(reasonsOf([...EN_TEXTS, ...swapped])).toEqual(['bilingual_not_sequential'])
  })

  it('报「不是逐字拼接」时要说得出**是哪一行**', () => {
    const check = checkPackage(withBilingual([...EN_TEXTS, ...CN_TEXTS, 'Page 1 of 2']))
    const failure = check.failures.find((item) => item.reason === 'bilingual_not_sequential')
    expect(failure?.offending).toBe('Page 1 of 2')
    expect(failure?.detail).toContain('Page 1 of 2')
  })

  it('完好的双语版三条都不响 —— 上面那组「必须响一条」才有意义', () => {
    expect(reasonsOf(CLEAN.views.bilingual.texts)).toEqual([])
    expect(CLEAN.check.pass).toBe(true)
  })
})
