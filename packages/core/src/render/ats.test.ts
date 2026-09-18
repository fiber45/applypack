import { describe, expect, it } from 'vitest'

import { maximalArchiveV1 } from '../schema/__fixtures__/maximal-archive'
import type { ArchiveV1 } from '../schema/index'
import { extractLines, extractText, lineOf, missingFields } from './ats'
import { decodeEntities, escapeHtml } from './escape'
import { FORBIDDEN_LAYOUT_PATTERNS, renderHtml } from './html'
import { buildDocumentModel } from './model'

const ARCHIVE = maximalArchiveV1

function render(target: 'resume_zh' | 'resume_en_campus' = 'resume_zh', archive: ArchiveV1 = ARCHIVE) {
  return renderHtml(buildDocumentModel(archive, { target }))
}

const HTML = render()
const TEXT = extractText(HTML)
const LINES = extractLines(HTML)

describe('T4a · ATS 可解析性', () => {
  it('必备字段齐全 —— 姓名 / 学校 / 公司 / 日期', () => {
    expect(
      missingFields(HTML, [
        '林知远',
        '某某大学',
        '杭州某某科技有限公司',
        '2025.06 – 2025.09',
        '校园二手交易推荐系统',
      ]),
    ).toEqual([])
  })

  it('**B 级字段必须出现在产物里** —— 与出网层恰好相反的那一条线', () => {
    // 这一条与 `egress/b-level-never-egress.test.ts` 是一组对照：
    // 同一个手机号在那边断言「绝不出网」，在这边断言「必须印在简历上」。
    // 两者同时成立，才说明 DESIGN 1.3 的判据被正确实现了 ——
    // B 级管的是「进不进模型请求」，不是「能不能上简历」。
    expect(TEXT).toContain('林知远')
    expect(TEXT).toContain('linzhiyuan@example.com')
    expect(TEXT).toContain('+8613800138000')
    expect(TEXT).toContain('杭州')
  })

  it('顺序正确：姓名在联系方式之前', () => {
    const nameLine = lineOf(LINES, '林知远')
    const emailLine = lineOf(LINES, 'linzhiyuan@example.com')
    expect(nameLine).toBeGreaterThanOrEqual(0)
    expect(emailLine).toBeGreaterThan(nameLine)
  })

  it('顺序正确：校招场景下教育节排在经历节之前', () => {
    const education = lineOf(LINES, '某某大学')
    const work = lineOf(LINES, '杭州某某科技有限公司')
    expect(education).toBeGreaterThanOrEqual(0)
    expect(work).toBeGreaterThan(education)
  })

  it('各节标题按目标顺序出现', () => {
    const headings = ['教育背景', '工作经历', '项目经历', '专业技能', '语言能力', '荣誉奖项', '证书']
    const positions = headings.map((heading) => lineOf(LINES, heading))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('日期与公司落在相邻的行里 —— 拼成一个长串会让 ATS 丢掉归属关系', () => {
    const companyLine = lineOf(LINES, '杭州某某科技有限公司')
    expect(LINES[companyLine + 1]).toContain('2025.06')
  })

  it('英文 target 取英文语种与英文节标题', () => {
    const en = extractText(render('resume_en_campus'))
    expect(en).toContain('Lin Zhiyuan')
    expect(en).toContain('Education')
    expect(en).toContain('Experience')
    expect(en).not.toContain('教育背景')
  })

  it('i18n 缺失时回退另一语种，而不是留空', () => {
    const partial = {
      ...ARCHIVE,
      projects: [{ ...ARCHIVE.projects[0], name: { zh: '只有中文的项目名' } }],
    } as unknown as ArchiveV1
    expect(extractText(render('resume_en_campus', partial))).toContain('只有中文的项目名')
  })
})

describe('T4a · 排版纪律', () => {
  it('产物里不存在任何分栏 / 绝对定位 / 表格布局', () => {
    for (const pattern of FORBIDDEN_LAYOUT_PATTERNS) {
      expect(HTML).not.toContain(pattern)
    }
  })

  it('禁止清单本身非空 —— 否则上面那条断言是空转', () => {
    expect(FORBIDDEN_LAYOUT_PATTERNS.length).toBeGreaterThan(5)
  })

  it('文本不依赖样式表：去掉 <style> 后抽出的文本完全一致', () => {
    const withoutStyle = HTML.replace(/<style[\s\S]*?<\/style>/gi, '')
    expect(extractText(withoutStyle)).toBe(TEXT)
  })

  it('文本不依赖脚本：产物里根本没有 script', () => {
    expect(HTML).not.toContain('<script')
  })

  it('每条要点各自成行，不被压成一段', () => {
    expect(LINES).toContain('负责召回通道的特征工程，累计上线 12 个特征')
    expect(LINES).toContain('将离线特征回填耗时从 4.2 小时降至 38 分钟')
  })
})

describe('T4a · 转义与结构安全', () => {
  it('HTML 实体往返无损', () => {
    const raw = 'a<b>&"c"\'d\''
    expect(decodeEntities(escapeHtml(raw))).toBe(raw)
  })

  it('档案里的尖括号不会破坏结构，也不会被吞掉', () => {
    const tricky = {
      ...ARCHIVE,
      basics: { ...ARCHIVE.basics, name: { zh: '张<三> & 李' } },
    } as unknown as ArchiveV1
    const html = render('resume_zh', tricky)
    expect(extractText(html)).toContain('张<三> & 李')
    // 转义后的形式不允许以裸标签的形态出现在源码里
    expect(html).not.toMatch(/<h1>张<三>/)
  })

  it('未闭合的实体样式不会破坏标签剥离', () => {
    const messy = `<!DOCTYPE html><body><p>a &amp; b</p></body>`
    expect(extractText(messy)).toBe('a & b')
  })
})

describe('T4a · 文档模型', () => {
  it('可以只渲染指定的条目（接匹配结果）', () => {
    const model = buildDocumentModel(ARCHIVE, {
      target: 'resume_zh',
      includedEntryIds: ['education.0'],
    })
    expect(model.sections.map((section) => section.id)).toEqual(['education'])
  })

  it('改写后的要点可以按 entryId 覆盖原文', () => {
    const polished = ['负责召回通道的特征工程，上线 12 个特征']
    const model = buildDocumentModel(ARCHIVE, {
      target: 'resume_zh',
      rewritten: new Map([['work.0', polished]]),
    })
    const work = model.sections.find((section) => section.id === 'work')
    expect(work?.entries[0]?.bullets).toEqual(polished)
  })

  it('空节不渲染 —— 不留一个只有标题的空壳', () => {
    const model = buildDocumentModel(ARCHIVE, {
      target: 'resume_zh',
      includedEntryIds: ['work.0'],
    })
    expect(model.sections.map((section) => section.id)).toEqual(['work'])
  })

  it('联系方式顺序固定，不随档案字段顺序漂移', () => {
    const model = buildDocumentModel(ARCHIVE, { target: 'resume_zh' })
    expect(model.contacts.map((line) => line.label)).toEqual(['邮箱', '电话', '微信', '城市'])
  })

  it('构建模型是纯函数：同输入同输出（快照断言才有意义）', () => {
    expect(render()).toBe(HTML)
  })
})
