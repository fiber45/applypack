import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import type { ArchiveV1 } from '../schema/index'
import { RESUME_STYLES } from './html'
import { CAMPUS_LAYOUT, MM_PER_PT, type BlockKind } from './layout'
import { buildDocumentModel } from './model'
import {
  advanceEm,
  bodyLinePt,
  columnHeightPt,
  columnWidthPt,
  estimatePages,
  layoutBlocks,
  wrappedLines,
} from './paginate'

const BLOCKS = CAMPUS_LAYOUT.blocks
const LAYOUT = CAMPUS_LAYOUT

function zh(archive: ArchiveV1) {
  return buildDocumentModel(archive, { target: 'resume_zh' })
}

describe('T4b · 版式常量与样式表不漂移', () => {
  /**
   * 这一组的存在理由与 T2.1 的 `schema-snapshot.test.ts` 完全相同：
   * 常量与 CSS 是两份手写的东西，**漂移的症状是页数估算悄悄偏一边**，
   * 而不是某个东西报错。断言把它们钉在一起 —— 改一处而不改另一处会红。
   */
  const DRIFT: [string, string][] = [
    ['body 字号', `font-size: ${LAYOUT.bodyFontPt}pt`],
    ['行距', `line-height: ${LAYOUT.lineHeight}`],
    [
      '正文宽度 = 页宽 − 两侧页边距',
      `width: ${LAYOUT.page.widthMm - 2 * LAYOUT.page.marginMm}mm`,
    ],
    ['@page 纸张与页边距', `@page { size: A4; margin: ${LAYOUT.page.marginMm}mm; }`],
    ['h1 字号', `h1 { font-size: ${BLOCKS.name.fontPt}pt`],
    ['h1 下边距', `margin: 0 0 ${BLOCKS.name.marginBottomPt}pt`],
    ['.label 字号', `.label { font-size: ${BLOCKS.label.fontPt}pt`],
    ['.label 下边距', `margin: 0 0 ${BLOCKS.label.marginBottomPt}pt`],
    ['.contacts 字号', `.contacts { list-style: none; padding: 0; margin: 0 0 10pt; font-size: ${BLOCKS.contacts.fontPt}pt`],
    ['联系方式间隔', `margin-right: ${LAYOUT.contactGapPt}pt`],
    ['.summary 上下边距', `margin: ${BLOCKS.summary.marginTopPt}pt 0`],
    ['h2 字号', `h2 { font-size: ${BLOCKS.sectionHeading.fontPt}pt`],
    [
      'h2 上下边距',
      `margin: ${BLOCKS.sectionHeading.marginTopPt}pt 0 ${BLOCKS.sectionHeading.marginBottomPt}pt`,
    ],
    ['条目标题字号', `.entry h3 { font-size: ${BLOCKS.entryHeading.fontPt}pt`],
    ['.meta 字号', `.meta { font-size: ${BLOCKS.entryMeta.fontPt}pt`],
    ['.meta 上边距', `margin: ${BLOCKS.entryMeta.marginTopPt}pt 0 0`],
    ['条目下边距', `.entry { margin: 0 0 ${BLOCKS.entryGap.marginBottomPt}pt`],
    ['列表上边距', `ul { margin: ${BLOCKS.listGap.marginTopPt}pt 0 0`],
    ['列表缩进', `padding-left: ${BLOCKS.bullet.indentPt}pt`],
    ['要点上下边距', `li { margin: ${BLOCKS.bullet.marginTopPt}pt 0; }`],
  ]

  it.each(DRIFT)('%s：常量与 CSS 一致', (_label, fragment) => {
    expect(RESUME_STYLES).toContain(fragment)
  })

  it('每条漂移断言都带一个能说话的标签 —— 否则失败信息是一串 CSS', () => {
    expect(DRIFT.length).toBeGreaterThan(15)
    expect(DRIFT.every(([label]) => label.trim() !== '')).toBe(true)
  })

  it('块清单恰好是这些 —— 增删块必须同时改这里与渲染器', () => {
    // 枚举少了块 ⇒ 高度低估 ⇒ 「一页」这条断言会说「刚好」而实际超了。
    // 这是唯一一个会静默出错的改动方向，所以用一条显式清单挡住它。
    const kinds: readonly BlockKind[] = [
      'name',
      'label',
      'contacts',
      'summary',
      'sectionHeading',
      'entryHeading',
      'entryMeta',
      'listGap',
      'bullet',
      'entryGap',
    ]
    expect(Object.keys(BLOCKS).sort()).toEqual([...kinds].sort())
  })

  it('正文块的字号等于 body 声明的字号 —— li 继承 body，不单独声明', () => {
    expect(BLOCKS.bullet.fontPt).toBe(LAYOUT.bodyFontPt)
    expect(BLOCKS.summary.fontPt).toBe(LAYOUT.bodyFontPt)
  })

  it('样式表里没有分栏 / 绝对定位 —— 与 T4a 同一份禁止清单', () => {
    // 双语版是「顺序拼页」，而最容易走歪的实现正是并排两栏。
    // 这条断言与 `renderBilingualHtml` 里那个断页元素是一对。
    expect(RESUME_STYLES).not.toContain('column-count')
    expect(RESUME_STYLES).not.toContain('display: grid')
    expect(RESUME_STYLES).not.toContain('position: absolute')
  })
})

describe('T4b · 版式几何', () => {
  it('可用宽度与高度由纸张与页边距算出（A4 + 14mm）', () => {
    // 这三个数字是版式的指纹。改动它们必须是有意的：页数估算的一切
    // 都以它们为准，而「一页」这条断言的临界值会随它们整体平移。
    expect(MM_PER_PT).toBeCloseTo(0.3527778, 6)
    expect(columnWidthPt(LAYOUT)).toBeCloseTo(515.9, 1)
    expect(columnHeightPt(LAYOUT)).toBeCloseTo(762.5, 1)
    expect(bodyLinePt(LAYOUT)).toBeCloseTo(15.75, 6)
  })

  it('一页大约能放 48 行正文 —— 估算若偏离这个量级，常量一定是错的', () => {
    const linesPerPage = columnHeightPt(LAYOUT) / bodyLinePt(LAYOUT)
    expect(linesPerPage).toBeGreaterThan(44)
    expect(linesPerPage).toBeLessThan(52)
  })

  it('中文字符按全宽、拉丁字符按半宽计', () => {
    // 同一段字符数，中文占的宽度必须显著更多 —— 否则中英混排的行数估算
    // 会趋于一致，而它们实际差将近一倍，一页的边界会整体算错。
    const cjk = advanceEm('杭州某某大学', LAYOUT)
    const latin = advanceEm('HangzhouCN', LAYOUT)
    expect(cjk).toBeCloseTo(6 * LAYOUT.glyphEm.cjk, 6)
    expect(latin).toBeCloseTo(10 * LAYOUT.glyphEm.latin, 6)

    // 汉字 1em、拉丁 0.55em：六对十，宽度仍然更宽。
    expect(cjk).toBeGreaterThan(latin)
    // 反过来：同样 10 个字符时中文占得更多（这才是这条判据的用途）。
    expect(advanceEm('一二三四五六七八九十', LAYOUT)).toBeGreaterThan(
      advanceEm('abcdefghij', LAYOUT),
    )
  })

  it('行数按可用宽度折算，且至少一行', () => {
    expect(wrappedLines('', LAYOUT.bodyFontPt, LAYOUT, 0)).toBe(1)
    expect(wrappedLines('短', LAYOUT.bodyFontPt, LAYOUT, 0)).toBe(1)
    // 无文字的块不占行。
    expect(wrappedLines('anything', BLOCKS.entryGap.fontPt, LAYOUT, 0)).toBe(0)

    const short = wrappedLines('a'.repeat(10), LAYOUT.bodyFontPt, LAYOUT, 0)
    const long = wrappedLines('a'.repeat(400), LAYOUT.bodyFontPt, LAYOUT, 0)
    expect(long).toBeGreaterThan(short)

    // 缩进会减少可用宽度，于是同一段文字占更多行 ——
    // 要点是缩进的，这一点若不建模，长要点会系统性少算一行。
    const flat = wrappedLines('a'.repeat(300), LAYOUT.bodyFontPt, LAYOUT, 0)
    const indented = wrappedLines('a'.repeat(300), LAYOUT.bodyFontPt, LAYOUT, BLOCKS.bullet.indentPt)
    expect(indented).toBeGreaterThanOrEqual(flat)
  })
})

describe('T4b · 页数估算的性质', () => {
  it('块清单覆盖了模型的每一处内容', () => {
    const model = zh(maximalArchiveV1)
    const kinds = layoutBlocks(model, LAYOUT).map((block) => block.kind)
    expect(kinds).toContain('name')
    expect(kinds).toContain('contacts')
    expect(kinds).toContain('summary')
    expect(kinds).toContain('sectionHeading')
    expect(kinds).toContain('bullet')
    // 7 个节 ⇒ 至少 7 次节标题
    expect(kinds.filter((kind) => kind === 'sectionHeading').length).toBe(7)
  })

  it('**单调**：加内容不会让页数变小', () => {
    // 一个把页数算成常数的估算器能通过任何「等于几页」的断言。
    const short = zh(maximalArchiveV1)
    const longer = {
      ...short,
      sections: short.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              entries: section.entries.map((entry) => ({
                ...entry,
                bullets: [...entry.bullets, ...Array.from({ length: 60 }, (_, i) => `要点 ${i}`)],
              })),
            }
          : section,
      ),
    }
    const before = estimatePages([short], LAYOUT)
    const after = estimatePages([longer], LAYOUT)
    expect(after.usedPt).toBeGreaterThan(before.usedPt)
    expect(after.pages).toBeGreaterThanOrEqual(before.pages)
  })

  it('**非平凡**：塞满全部字段的档案一定不是一页', () => {
    // 这一条与 package.test.ts 里「校招样本是一页」配成一对：
    // 只有两条同时成立，才说明估算器真在读内容，而不是恒定输出「一页」。
    const estimate = estimatePages([zh(maximalArchiveV1)], LAYOUT)
    expect(estimate.fitsOnePage).toBe(false)
    expect(estimate.pages).toBeGreaterThanOrEqual(2)
    expect(estimate.overflowPt).toBeGreaterThan(0)
    expect(estimate.slackPt).toBe(0)
  })

  it('空档案仍然占一页 —— 一张纸不会因为没字而消失', () => {
    const empty = estimatePages(
      [buildDocumentModel({ ...maximalArchiveV1, work: [], education: [], projects: [], skills: [], languages: [], certificates: [], awards: [] }, { target: 'resume_zh' })],
      LAYOUT,
    )
    expect(empty.pages).toBe(1)
    expect(empty.fitsOnePage).toBe(true)
    expect(empty.slackPt).toBeGreaterThan(0)
  })

  it('**拼页求和是精确的**：两半各自从新页开始，不存在跨页断点', () => {
    const cn = zh(maximalArchiveV1)
    const en = buildDocumentModel(maximalArchiveV1, { target: 'resume_en_campus' })
    const cnOnly = estimatePages([cn], LAYOUT)
    const enOnly = estimatePages([en], LAYOUT)
    const parts = estimatePages([cn, en], LAYOUT)

    // 同一个 `ceil` 公式，单份文档上是近似、拼页时是精确 —— 差值就在这里。
    expect(parts.pages).toBe(cnOnly.pages + enOnly.pages)
    expect(parts.usedPt).toBeCloseTo(cnOnly.usedPt + enOnly.usedPt, 1)
    // 两稿都不短，否则上面那条加法在「两边都是 1 页」时也成立。
    expect(cnOnly.pages).toBeGreaterThan(1)
    expect(enOnly.pages).toBeGreaterThan(1)
  })

  it('`slackPt` 与 `overflowPt` 恰有一个为正，且和等于离一页的距离', () => {
    for (const archive of [maximalArchiveV1, { ...maximalArchiveV1, awards: [], certificates: [] }]) {
      const estimate = estimatePages([zh(archive as ArchiveV1)], LAYOUT)
      expect(estimate.slackPt === 0 || estimate.overflowPt === 0).toBe(true)
      // 两者之和是**到一页边线的距离**（不分方向），不是到「总容量」的距离 ——
      // 后者会恒为 0，因为 `pages` 本来就是按内容算出来的。
      expect(estimate.slackPt + estimate.overflowPt).toBeCloseTo(
        Math.abs(estimate.capacityPt - estimate.usedPt),
        1,
      )
    }
  })

  it('超页时 `overflowPt` 是「要删掉多少」—— 它必须可能非零', () => {
    // 一个把溢出算成 `used - pages × 单页` 的实现会永远返回 0，
    // 于是报告里写着「超出 0pt」而实际超了一页。这条断言就是防它的。
    const estimate = estimatePages([zh(maximalArchiveV1)], LAYOUT)
    expect(estimate.overflowPt).toBeGreaterThan(0)
    expect(estimate.slackPt).toBe(0)
    expect(estimate.capacityPt).toBeCloseTo(columnHeightPt(LAYOUT), 1)
  })

  it('估算无状态：同一模型两次调用结果逐字相同', () => {
    const model = zh(maximalArchiveV1)
    expect(estimatePages([model], LAYOUT)).toEqual(estimatePages([model], LAYOUT))
  })
})
