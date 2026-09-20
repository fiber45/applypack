// @vitest-environment node
/**
 * T9.1a 简历解析 —— 纯逻辑：文本行 → 分区识别结果 → 并入编辑器草稿。
 *
 * ## 为什么解析是启发式还要写进核心逻辑层
 *
 * 用户手里的存量简历是 PDF/文字，让他对着编辑器逐格重敲一遍是把「数据库」
 * 的录入成本全压在人身上。但任意版式的简历没有可靠语法 —— 所以这里的
 * 立场是三条：
 *
 * 1. **识别结果永远经人眼**：解析只产出「草稿候选」，落库前必过编辑器的
 *    三态闸门（invalid 连保存都够不着）；
 * 2. **只收有把握的**：每个分区条目只在其主必填字段被识别出来时才创建
 *    （work→公司、education→学校、project→项目名…），识别不出的行原样
 *    进 `leftover` 给用户看，绝不静默丢弃，也绝不造空壳条目；
 * 3. **并入永不覆盖**：`mergeParsed` 只填空字段 —— 用户已填的内容比
 *    解析的猜测值权威。
 */

export interface ParsedWorkEntry {
  readonly company: string
  readonly position?: string
  readonly startDate?: string
  readonly endDate?: string
  readonly highlights: readonly string[]
}

export interface ParsedEducationEntry {
  readonly institution: string
  readonly area?: string
  readonly studyType?: string
  readonly startDate?: string
  readonly endDate?: string
  readonly highlights: readonly string[]
}

export interface ParsedProjectEntry {
  readonly name: string
  readonly startDate?: string
  readonly endDate?: string
  readonly highlights: readonly string[]
}

export interface ParsedLanguageEntry {
  readonly language: { zh?: string; en?: string }
  readonly score?: string
}

export interface ParsedResume {
  readonly name?: { zh?: string; en?: string }
  readonly email?: string
  readonly phone?: string
  readonly summary?: string
  readonly work: readonly ParsedWorkEntry[]
  readonly education: readonly ParsedEducationEntry[]
  readonly projects: readonly ParsedProjectEntry[]
  readonly skills: readonly string[]
  readonly languages: readonly ParsedLanguageEntry[]
  readonly certificates: readonly string[]
  readonly awards: readonly string[]
  /** 识别不了、原样退还的行 —— 解析器的诚实清单。 */
  readonly leftover: readonly string[]
}

// ---------------------------------------------------------------------------
// 识别模式
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/

const PHONE_PATTERN = /(?:\+?86[-\s]?)?1[3-9]\d{9}/

/** 区间日期：`2024-06 - 2024-09` / `2023.6~2024.3` / `2024-01 - 至今` / `2023 年 7 月 - 2023 年 10 月`。 */
const DATE_RANGE_PATTERN =
  /(\d{4})\s*[.\-/年]\s*(\d{1,2})?\s*月?\s*(?:[-–—~～]|\bto\b|至)\s*(?:(\d{4})\s*[.\-/年]\s*(\d{1,2})?\s*月?|至今|present|now)/i

/** 行尾孤立日期（奖项 / 证书常见）：`National Scholarship 2023-10`。 */
const TRAILING_DATE_PATTERN = /(?:^|\s)(\d{4})(?:\s*[.\-/年]\s*(\d{1,2}))?\s*月?\s*$/

const BULLET_PATTERN = /^(?:[-•·●◦*・]|\d{1,2}[.、)])\s*/

/** 分区标题：短、无数字、命中关键词。顺序有讲究 —— 「项目经历」先于「经历」。 */
const SECTION_HEADERS: ReadonlyArray<{ readonly section: SectionId; readonly pattern: RegExp }> = [
  { section: 'education', pattern: /教育|学业|EDUCATION/i },
  { section: 'projects', pattern: /项目|PROJECT/i },
  { section: 'work', pattern: /实习|工作|经历|经验|EXPERIENCE|INTERNSHIP|EMPLOYMENT|CAREER/i },
  { section: 'skills', pattern: /技能|SKILL/i },
  { section: 'languages', pattern: /语言|LANGUAGE/i },
  { section: 'certificates', pattern: /证书|CERTIF|资格/i },
  { section: 'awards', pattern: /奖项|荣誉|获奖|AWARD|HONOR/i },
  { section: 'summary', pattern: /自我评价|自我介绍|个人简介|关于我|SUMMARY|ABOUT/i },
  { section: 'contact', pattern: /联系方式|联系信息|个人信息|CONTACT/i },
]

type SectionId =
  | 'prologue'
  | 'education'
  | 'work'
  | 'projects'
  | 'skills'
  | 'languages'
  | 'certificates'
  | 'awards'
  | 'summary'
  | 'contact'

const DEGREE_PATTERN =
  /^(?:本科|硕士|研究生|博士|大专|专科|学士|B\.?S\.?|M\.?S\.?|B\.?A\.?|Bachelor(?:\s+of.*)?|Master(?:\s+of.*)?|Ph\.?D.*)$/i

const LANGUAGE_PATTERNS: ReadonlyArray<{ readonly name: string; readonly pattern: RegExp }> = [
  { name: '英语', pattern: /CET-?\s*6|CET-?\s*4|大学英语|雅思|IELTS|TOEFL|托福|英语|English/i },
  { name: '日语', pattern: /日语|日语能力|Japanese|JLPT/i },
  { name: '法语', pattern: /法语|French/i },
  { name: '德语', pattern: /德语|German/i },
]

/** 中文字后跟单个空格是分词；英文内部单空格不是 —— 双空格或标点才是。 */
const TOKEN_SPLIT_PATTERN = /(?<=[\u4e00-\u9fa5])\s+|\s{2,}|[｜|，,、·]+/

// ---------------------------------------------------------------------------
// parseResumeText
// ---------------------------------------------------------------------------

function normalizeDate(year: string, month?: string): string {
  return month === undefined ? year : `${year}-${month.padStart(2, '0')}`
}

interface DateRangeParts {
  readonly start: string | undefined
  readonly end: string | undefined
  /** 从原行里抠掉日期后的剩余文本。 */
  readonly rest: string
}

function extractDateRange(line: string): DateRangeParts | undefined {
  const match = DATE_RANGE_PATTERN.exec(line)
  if (match !== null) {
    const start = normalizeDate(match[1]!, match[2])
    const end = match[3] !== undefined ? normalizeDate(match[3]!, match[4]) : undefined
    return { start, end, rest: (line.slice(0, match.index) + ' ' + line.slice(match.index + match[0].length)).trim() }
  }
  const trailing = TRAILING_DATE_PATTERN.exec(line)
  if (trailing !== null) {
    return {
      start: undefined,
      end: normalizeDate(trailing[1]!, trailing[2]),
      rest: line.slice(0, trailing.index).trim(),
    }
  }
  return undefined
}

function tokenize(rest: string): string[] {
  return rest
    .split(TOKEN_SPLIT_PATTERN)
    .map((token) => token.trim())
    .filter((token) => token !== '')
}

function isSectionHeader(line: string): { readonly section: SectionId } | undefined {
  // 标题行三重守卫：无数字、无标点、够短。标点守卫挡住「热爱开源，做过三个
  // 校招项目」这种含关键词的正文；长度守卫挡住「随便写的自我介绍」这种整句
  // 巧合命中 —— 中文标题惯常 4 字，给了 6 字余量，代价是 7 字以上的中文
  // 标题识别不到（宁可漏识别进 leftover，不可误切分区）。
  if (/\d/.test(line) || /[，。；,;]/.test(line)) return undefined
  const maxLength = /[\u4e00-\u9fa5]/.test(line) ? 6 : 30
  if (line.length > maxLength) return undefined
  for (const { section, pattern } of SECTION_HEADERS) {
    if (pattern.test(line)) return { section }
  }
  return undefined
}

function detectLanguage(line: string): { name: { zh: string }; score?: string } | undefined {
  for (const { name, pattern } of LANGUAGE_PATTERNS) {
    if (!pattern.test(line)) continue
    const score = /(?<![\w.])\d{2,4}(?:\.\d)?(?![\w.])/.exec(line)?.[0]
    return score !== undefined
      ? { name: { zh: name }, score }
      : { name: { zh: name } }
  }
  return undefined
}

/** 可变构造体 —— parseResumeText 内部累积用，出口转 readonly。 */
interface MutableResume {
  name?: { zh?: string; en?: string }
  email?: string
  phone?: string
  summary?: string
  work: ParsedWorkEntry[]
  education: ParsedEducationEntry[]
  projects: ParsedProjectEntry[]
  skills: string[]
  languages: ParsedLanguageEntry[]
  certificates: string[]
  awards: string[]
  leftover: string[]
}

interface MutableEntries {
  work?:
    | { company: string; position?: string; start?: string; end?: string; highlights: string[] }
    | undefined
  education?:
    | {
        institution: string
        area?: string
        studyType?: string
        start?: string
        end?: string
        highlights: string[]
      }
    | undefined
  project?: { name: string; start?: string; end?: string; highlights: string[] } | undefined
}

export function parseResumeText(raw: string): ParsedResume {
  const out: MutableResume = {
    work: [],
    education: [],
    projects: [],
    skills: [],
    languages: [],
    certificates: [],
    awards: [],
    leftover: [],
  }

  let section: SectionId = 'prologue'
  let current: MutableEntries = {}
  let nameChecked = false
  let summaryLines: string[] = []

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

  const closeWork = (): void => {
    if (current.work !== undefined) {
      const e = current.work
      out.work.push({
        company: e.company,
        ...(e.position !== undefined ? { position: e.position } : {}),
        ...(e.start !== undefined ? { startDate: e.start } : {}),
        ...(e.end !== undefined ? { endDate: e.end } : {}),
        highlights: e.highlights,
      })
    }
    current.work = undefined
  }
  const closeEducation = (): void => {
    if (current.education !== undefined) {
      const e = current.education
      out.education.push({
        institution: e.institution,
        ...(e.area !== undefined ? { area: e.area } : {}),
        ...(e.studyType !== undefined ? { studyType: e.studyType } : {}),
        ...(e.start !== undefined ? { startDate: e.start } : {}),
        ...(e.end !== undefined ? { endDate: e.end } : {}),
        highlights: e.highlights,
      })
    }
    current.education = undefined
  }
  const closeProject = (): void => {
    if (current.project !== undefined) {
      const e = current.project
      out.projects.push({
        name: e.name,
        ...(e.start !== undefined ? { startDate: e.start } : {}),
        ...(e.end !== undefined ? { endDate: e.end } : {}),
        highlights: e.highlights,
      })
    }
    current.project = undefined
  }
  const closeAll = (): void => {
    closeWork()
    closeEducation()
    closeProject()
  }

  for (const line0 of lines) {
    const header = isSectionHeader(line0)
    if (header !== undefined) {
      closeAll()
      section = header.section
      continue
    }

    // 联系方式在任何分区行里都顺手抽走（信封地址式排版很常见）。
    const emailMatch = EMAIL_PATTERN.exec(line0)
    if (emailMatch !== null && out.email === undefined) out.email = emailMatch[0]
    const phoneMatch = PHONE_PATTERN.exec(line0)
    if (phoneMatch !== null && out.phone === undefined) out.phone = phoneMatch[0]
    const hasContact = emailMatch !== null || phoneMatch !== null

    switch (section) {
      case 'prologue':
      case 'contact': {
        // 首行短纯文字 = 姓名猜测。
        if (!nameChecked && section === 'prologue') {
          nameChecked = true
          if (/^[\u4e00-\u9fa5·]{2,4}$/.test(line0)) {
            out.name = { zh: line0 }
            break
          }
          if (/^[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+$/.test(line0)) {
            out.name = { en: line0 }
            break
          }
        }
        if (!hasContact) out.leftover.push(line0)
        break
      }

      case 'summary': {
        summaryLines.push(line0)
        break
      }

      case 'skills': {
        const tokens = line0.split(/[,，、;；|]+/).map((t) => t.trim()).filter((t) => t !== '')
        const kept = tokens.filter((t) => t.length <= 30)
        if (kept.length === 0) {
          out.leftover.push(line0)
        } else {
          out.skills.push(...kept)
        }
        break
      }

      case 'languages': {
        const lang = detectLanguage(line0)
        if (lang !== undefined) {
          out.languages.push(lang.score !== undefined ? { language: lang.name, score: lang.score } : { language: lang.name })
        } else {
          const tokens = tokenize(line0)
          if (tokens.length > 0 && tokens[0]!.length <= 12) {
            out.languages.push({ language: { zh: tokens[0]! } })
          } else {
            out.leftover.push(line0)
          }
        }
        break
      }

      case 'certificates': {
        const parts = extractDateRange(line0)
        const rest = (parts?.rest ?? line0).replace(BULLET_PATTERN, '').trim()
        if (rest !== '') out.certificates.push(rest)
        else out.leftover.push(line0)
        break
      }

      case 'awards': {
        const parts = extractDateRange(line0)
        const rest = (parts?.rest ?? line0).replace(BULLET_PATTERN, '').trim()
        if (rest !== '') out.awards.push(rest)
        else out.leftover.push(line0)
        break
      }

      case 'education': {
        // 圆点行永远是上一条的要点，绝不许开新条目（哪怕带日期）。
        const bullet = line0.replace(BULLET_PATTERN, '')
        if (bullet !== line0) {
          if (current.education !== undefined) current.education.highlights.push(bullet)
          else out.leftover.push(line0)
          break
        }
        // 条目行必须带区间日期：没有日期的散行不足以断定是新条目（宁进
        // leftover 不造空壳）。有日期的行开新条目（自动关掉上一条 ——
        // 多段经历靠这个并存）。
        if (!DATE_RANGE_PATTERN.test(line0)) {
          if (current.education !== undefined) current.education.highlights.push(line0)
          else out.leftover.push(line0)
          break
        }
        const parts = extractDateRange(line0)
        const tokens = tokenize(parts?.rest ?? line0)
        if (tokens.length === 0) {
          out.leftover.push(line0)
          break
        }
        const entry: NonNullable<MutableEntries['education']> = {
          institution: tokens[0]!,
          highlights: [],
        }
        if (parts?.start !== undefined) entry.start = parts.start
        if (parts?.end !== undefined) entry.end = parts.end
        let areaSet = false
        for (const token of tokens.slice(1)) {
          if (DEGREE_PATTERN.test(token) && entry.studyType === undefined) {
            entry.studyType = token
          } else if (!areaSet) {
            entry.area = token
            areaSet = true
          } else {
            entry.highlights.push(token)
          }
        }
        closeEducation()
        current.education = entry
        break
      }

      case 'work': {
        if (!DATE_RANGE_PATTERN.test(line0)) {
          const bullet = line0.replace(BULLET_PATTERN, '')
          if (current.work !== undefined) current.work.highlights.push(bullet)
          else out.leftover.push(line0)
          break
        }
        const parts = extractDateRange(line0)
        const tokens = tokenize(parts?.rest ?? line0)
        if (tokens.length === 0) {
          out.leftover.push(line0)
          break
        }
        closeWork()
        current.work = {
          company: tokens[0]!,
          ...(tokens[1] !== undefined ? { position: tokens[1] } : {}),
          ...(parts?.start !== undefined ? { start: parts.start } : {}),
          ...(parts?.end !== undefined ? { end: parts.end } : {}),
          highlights: tokens.slice(2),
        }
        break
      }

      case 'projects': {
        if (!DATE_RANGE_PATTERN.test(line0)) {
          const bullet = line0.replace(BULLET_PATTERN, '')
          if (current.project !== undefined) current.project.highlights.push(bullet)
          else out.leftover.push(line0)
          break
        }
        const parts = extractDateRange(line0)
        const tokens = tokenize(parts?.rest ?? line0)
        if (tokens.length === 0) {
          out.leftover.push(line0)
          break
        }
        closeProject()
        current.project = {
          name: tokens[0]!,
          ...(parts?.start !== undefined ? { start: parts.start } : {}),
          ...(parts?.end !== undefined ? { end: parts.end } : {}),
          highlights: tokens.slice(1),
        }
        break
      }
    }
  }
  closeAll()

  if (summaryLines.length > 0) out.summary = summaryLines.join('\n')

  return out
}

// ---------------------------------------------------------------------------
// mergeParsed —— 只补空，不覆盖
// ---------------------------------------------------------------------------

type ArchiveV1Like = import('../../../../core/src/schema/index').ArchiveV1

/**
 * 把识别结果并入编辑器草稿。规则：
 * - basics 的字段只在**为空**时填入（用户已填的值权威）；
 * - 分区条目一律**追加**（多段实习并存，而不是互相顶掉）；
 * - 条目允许不完整（如公司识别出但职位没识别出）—— 编辑器的 invalid 态
 *   会列 issues 逼用户补全，这比造占位数据诚实；
 * - 结构不可变：输入 draft 不被改动。
 */
export function mergeParsed(draft: ArchiveV1Like, parsed: ParsedResume): ArchiveV1Like {
  const next = structuredClone(draft) as ArchiveV1Like

  if (parsed.name !== undefined && next.basics.name === undefined) {
    next.basics.name = parsed.name
  }
  if (parsed.email !== undefined && next.basics.contact.email === undefined) {
    next.basics.contact.email = parsed.email
  }
  if (parsed.phone !== undefined && next.basics.contact.phone === undefined) {
    next.basics.contact.phone = parsed.phone
  }
  if (parsed.summary !== undefined && next.basics.summary === undefined) {
    next.basics.summary = { zh: parsed.summary }
  }

  next.work.push(
    ...parsed.work.map(
      (e): ArchiveV1Like['work'][number] => ({
        company: e.company,
        position: e.position !== undefined ? { zh: e.position } : {},
        ...(e.startDate !== undefined ? { startDate: e.startDate } : {}),
        ...(e.endDate !== undefined ? { endDate: e.endDate } : {}),
        highlights: [...e.highlights],
      }),
    ),
  )
  next.education.push(
    ...parsed.education.map(
      (e): ArchiveV1Like['education'][number] => ({
        institution: e.institution,
        ...(e.area !== undefined ? { area: { zh: e.area } } : {}),
        ...(e.studyType !== undefined ? { studyType: { zh: e.studyType } } : {}),
        ...(e.startDate !== undefined ? { startDate: e.startDate } : {}),
        ...(e.endDate !== undefined ? { endDate: e.endDate } : {}),
        highlights: [...e.highlights],
      }),
    ),
  )
  next.projects.push(
    ...parsed.projects.map(
      (e): ArchiveV1Like['projects'][number] => ({
        name: { zh: e.name },
        keywords: [],
        ...(e.startDate !== undefined ? { startDate: e.startDate } : {}),
        ...(e.endDate !== undefined ? { endDate: e.endDate } : {}),
        highlights: [...e.highlights],
      }),
    ),
  )
  next.skills.push(
    ...parsed.skills.map(
      (name): ArchiveV1Like['skills'][number] => ({ name: { zh: name }, keywords: [] }),
    ),
  )
  next.languages.push(
    ...parsed.languages.map(
      (l): ArchiveV1Like['languages'][number] => ({
        language: l.language,
        ...(l.score !== undefined ? { score: l.score } : {}),
      }),
    ),
  )
  next.certificates.push(
    ...parsed.certificates.map(
      (name): ArchiveV1Like['certificates'][number] => ({ name: { zh: name } }),
    ),
  )
  next.awards.push(
    ...parsed.awards.map(
      (title): ArchiveV1Like['awards'][number] => ({ title: { zh: title } }),
    ),
  )

  return next
}
