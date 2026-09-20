// @vitest-environment node
/**
 * T9.1a 简历解析纯模型 —— 断言先行。
 *
 * 被测对象：`parseResumeText`（文本 → 分区识别结果）与
 * `mergeParsed`（识别结果 → 只补空地并入编辑器草稿）。
 *
 * 设计立场：
 * - **解析是启发式，所以结果必须可审计**：每个分区只收「主必填字段被
 *   识别出来」的条目；识别不了的行原样进 `leftover`，绝不静默丢弃。
 * - **并入永不覆盖**：用户已填的内容比解析的猜测值权威。
 * - **条目可以不完整**：work 识别出公司但没识别出职位时照样并入 ——
 *   编辑器的 invalid 态 + issues 列表会逼用户补全，这比占位数据诚实。
 */

import { describe, expect, it } from 'vitest'

import { archiveV1Schema, emptyArchiveV1 } from '../../../../core/src/schema/index'
import { editCandidate } from '../archive-editor/model'
import { mergeParsed, parseResumeText } from './parse'

const CN_RESUME = [
  '林知远',
  '电话：13800138000  邮箱：zhiyuan@example.com',
  '教育背景',
  '清华大学 计算机科学与技术 本科 2021-09 - 2025-06',
  'GPA 3.8/4.0，专业排名前 5%',
  '实习经历',
  '字节跳动 后端开发实习生 2024-06 - 2024-09',
  '- 负责网申表单自动填充服务',
  '美团 后端开发实习生 2023-07 - 2023-10',
  '- 维护订单服务',
  '项目经历',
  'applypack 本地优先简历生成器 2024-01 - 至今',
  '- 零后端端到端加密',
  '技能',
  'Java, Go, TypeScript、React',
  '语言',
  'CET-6 568',
  '自我评价',
  '热爱开源，做过三个校招项目',
].join('\n')

describe('parseResumeText：中文简历', () => {
  const parsed = parseResumeText(CN_RESUME)

  it('基本信息：姓名 / 电话 / 邮箱', () => {
    expect(parsed.name).toEqual({ zh: '林知远' })
    expect(parsed.phone).toBe('13800138000')
    expect(parsed.email).toBe('zhiyuan@example.com')
  })

  it('教育：一条，学校 / 专业 / 学历 / 起止齐全，要点行挂在 highlights', () => {
    expect(parsed.education).toHaveLength(1)
    const edu = parsed.education[0]!
    expect(edu.institution).toBe('清华大学')
    expect(edu.area).toBe('计算机科学与技术')
    expect(edu.studyType).toBe('本科')
    expect(edu.startDate).toBe('2021-09')
    expect(edu.endDate).toBe('2025-06')
    expect(edu.highlights.join(' ')).toContain('GPA 3.8/4.0')
  })

  it('实习：两段都识别（多段实习是本次的核心诉求）', () => {
    expect(parsed.work).toHaveLength(2)
    expect(parsed.work[0]!.company).toBe('字节跳动')
    expect(parsed.work[0]!.position).toBe('后端开发实习生')
    expect(parsed.work[0]!.startDate).toBe('2024-06')
    expect(parsed.work[0]!.endDate).toBe('2024-09')
    expect(parsed.work[0]!.highlights).toContain('负责网申表单自动填充服务')
    expect(parsed.work[1]!.company).toBe('美团')
    expect(parsed.work[1]!.highlights).toContain('维护订单服务')
  })

  it('项目：日期里「至今」不产生 endDate', () => {
    expect(parsed.projects).toHaveLength(1)
    expect(parsed.projects[0]!.name).toContain('applypack')
    expect(parsed.projects[0]!.startDate).toBe('2024-01')
    expect(parsed.projects[0]!.endDate).toBeUndefined()
    expect(parsed.projects[0]!.highlights).toContain('零后端端到端加密')
  })

  it('技能：中英文分隔符都能切开', () => {
    expect(parsed.skills).toEqual(['Java', 'Go', 'TypeScript', 'React'])
  })

  it('语言：CET-6 → 英语 + 分数', () => {
    expect(parsed.languages).toHaveLength(1)
    expect(parsed.languages[0]!.language).toEqual({ zh: '英语' })
    expect(parsed.languages[0]!.score).toBe('568')
  })

  it('自我评价进 summary', () => {
    expect(parsed.summary).toContain('热爱开源')
  })

  it('leftover 诚实：被消费的行绝不出现，未识别的行原样保留', () => {
    for (const line of parsed.leftover) {
      expect(line).not.toContain('字节跳动')
      expect(line).not.toContain('清华大学')
      expect(line).not.toContain('林知远')
    }
  })
})

describe('parseResumeText：英文简历（PDF 抽取的典型形态）', () => {
  const parsed = parseResumeText(
    [
      'Zhiyuan Lin',
      'Email: zhiyuan.lin@example.com | Phone: 13800138000',
      'EDUCATION',
      'Tsinghua University  Computer Science and Technology  Bachelor  2021-09 - 2025-06',
      'INTERNSHIP EXPERIENCE',
      'ByteDance  Software Engineer Intern  2024-06 - 2024-09',
      'Built internal recruitment tools',
    ].join('\n'),
  )

  it('英文姓名识别为 en', () => {
    expect(parsed.name).toEqual({ en: 'Zhiyuan Lin' })
  })

  it('教育：双空格分隔的 token 各归各位', () => {
    expect(parsed.education[0]!.institution).toBe('Tsinghua University')
    expect(parsed.education[0]!.area).toBe('Computer Science and Technology')
    expect(parsed.education[0]!.studyType).toBe('Bachelor')
  })

  it('实习：公司 / 职位 / 日期', () => {
    expect(parsed.work[0]!.company).toBe('ByteDance')
    expect(parsed.work[0]!.position).toBe('Software Engineer Intern')
  })
})

describe('parseResumeText：边界', () => {
  it('空文本：全分区为空，leftover 为空（空行不进 leftover）', () => {
    const parsed = parseResumeText('  \n \n')
    expect(parsed.work).toHaveLength(0)
    expect(parsed.education).toHaveLength(0)
    expect(parsed.leftover).toHaveLength(0)
    expect(parsed.name).toBeUndefined()
  })

  it('没有分区的纯文本：全部进 leftover，联系方式照样抽出来', () => {
    const parsed = parseResumeText('随便写的自我介绍\nanother@example.com\n')
    expect(parsed.email).toBe('another@example.com')
    expect(parsed.leftover).toContain('随便写的自我介绍')
  })

  it('工作分区里识别不出公司的行进 leftover，不造空壳条目', () => {
    const parsed = parseResumeText('实习经历\n就写了一句话\n')
    expect(parsed.work).toHaveLength(0)
    expect(parsed.leftover).toContain('就写了一句话')
  })
})

describe('mergeParsed：只补空，不覆盖', () => {
  it('空档案并入中文样例：work 两条、education 一条、联系方式就位，且整份过 schema', () => {
    const merged = mergeParsed(emptyArchiveV1(), parseResumeText(CN_RESUME))
    const result = archiveV1Schema.safeParse(merged)
    expect(result.success).toBe(true)
    expect(merged.work).toHaveLength(2)
    expect(merged.education).toHaveLength(1)
    expect(merged.basics.contact.phone).toBe('13800138000')
    expect(merged.basics.name).toEqual({ zh: '林知远' })
    expect(merged.basics.summary?.zh).toContain('热爱开源')
  })

  it('已有内容一字不动：手机号、姓名保持原值，分区条目照样追加', () => {
    const draft = archiveV1Schema.parse({
      schemaVersion: 1,
      basics: { name: { zh: '已有名字' }, contact: { phone: '13900000000' } },
      work: [{ company: '已有公司', position: { zh: '已有职位' }, highlights: [] }],
    })
    const merged = mergeParsed(draft, parseResumeText(CN_RESUME))
    expect(merged.basics.name).toEqual({ zh: '已有名字' })
    expect(merged.basics.contact.phone).toBe('13900000000')
    // 追加而不是替换：2 条解析出的 + 1 条原有的
    expect(merged.work).toHaveLength(3)
    expect(merged.work[0]!.company).toBe('已有公司')
  })

  it('解析出公司但没识别出职位的条目照样并入 —— 编辑器 invalid 态会逼用户补全', () => {
    const merged = mergeParsed(emptyArchiveV1(), parseResumeText('实习经历\n字节跳动 2024-06 - 2024-09\n'))
    const state = editCandidate(emptyArchiveV1(), merged)
    const issues = state.kind === 'invalid' ? state.issues.join('\n') : ''
    expect(state.kind).toBe('invalid')
    expect(issues).toMatch(/position/)
  })

  it('mergeParsed 结构不可变：输入 draft 不被改动', () => {
    const draft = emptyArchiveV1()
    const snapshot = JSON.stringify(draft)
    mergeParsed(draft, parseResumeText(CN_RESUME))
    expect(JSON.stringify(draft)).toBe(snapshot)
  })
})
