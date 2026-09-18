import { z } from 'zod'

import { collectFieldPolicies, type FieldPolicy, type LevelSpec } from './level'

/**
 * v1 个人档案 —— JSON Resume 的扩展版本。
 *
 * 相对 JSON Resume 的三处结构性扩展：
 *   1. **本地化字符串**：每个可翻译字段都是 `{ zh?, en? }`，而不是单语言字符串。
 *      英文简历不是翻译出来的（DESIGN 10.1），但同一份档案要能渲染出中英两版，
 *      所以语言维度放在字段里，而不是放在整份文档里。
 *   2. **open slot `customFields`**：用户自定义字段的唯一入口。语义未知 ⇒ 默认 B 级。
 *   3. **`schemaVersion` + 严格模式**：见下方「严格模式」注释。
 *
 * ## 严格模式（`.strictObject`，未知字段直接报错）
 *
 * 这是刻意的选择，也是本项目里少数几个「宁可报错也不容忍」的地方：
 * 未声明的字段**没有级别**，因而无法参与「B 级不出端」的判定 ——
 * 一个悄悄混进来的 `contacts_backup` 字段就能把整条红线绕过去。
 * 与其让未知字段静默留在档案里，不如让它直接解码失败。
 *
 * 代价是：**任何形状变更都必须 bump `schemaVersion` 并提供迁移函数**。
 * 这是好事 —— 严格模式让「忘了写迁移」变成不可能被忽略的硬错误。
 *
 * @see DESIGN.md 10.4 / 11.3 · AGENTS.md §5 红线 1、2
 */

/** `YYYY` / `YYYY-MM` / `YYYY-MM-DD`。统一到这三种粒度，避免 `03/04/2026` 在美英解读不同。 */
const PARTIAL_DATE_PATTERN = /^\d{4}(?:-\d{2})?(?:-\d{2})?$/

const partialDate = z
  .string()
  .regex(PARTIAL_DATE_PATTERN, '日期格式应为 YYYY、YYYY-MM 或 YYYY-MM-DD')

/**
 * 本地化字符串。至少要有一种语言 ——
 * 「各语言都为空」和「字段不存在」是两回事，前者是坏数据，后者是缺口（DESIGN 11）。
 */
const localizedString = z
  .strictObject({
    zh: z.string().min(1).optional(),
    en: z.string().min(1).optional(),
  })
  .refine((value) => value.zh !== undefined || value.en !== undefined, {
    message: '本地化字符串至少需要一种语言（zh 或 en）',
  })

/** 只用于分析的说明性字段，不参与评分。 */
const note = z.string().min(1)

const profileItem = z.strictObject({
  network: z.string().min(1),
  username: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
})

const workItem = z.strictObject({
  company: z.string().min(1),
  position: localizedString,
  startDate: partialDate.optional(),
  /** 缺省即「至今」—— 用缺省表达而不是 `"present"` 这类词，免得把语言带进数据 */
  endDate: partialDate.optional(),
  location: z.string().min(1).optional(),
  summary: localizedString.optional(),
  highlights: z.array(z.string()).default([]),
})

const educationItem = z.strictObject({
  institution: z.string().min(1),
  area: localizedString.optional(),
  studyType: localizedString.optional(),
  startDate: partialDate.optional(),
  endDate: partialDate.optional(),
  gpa: z.string().min(1).optional(),
  score: z.string().min(1).optional(),
  highlights: z.array(z.string()).default([]),
})

const projectItem = z.strictObject({
  name: localizedString,
  description: localizedString.optional(),
  highlights: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
  startDate: partialDate.optional(),
  endDate: partialDate.optional(),
  url: z.string().min(1).optional(),
})

const skillItem = z.strictObject({
  name: localizedString,
  level: z.string().min(1).optional(),
  keywords: z.array(z.string()).default([]),
})

const languageItem = z.strictObject({
  language: localizedString,
  fluency: z.string().min(1).optional(),
  /** CET / IELTS / TOEFL 等分数。属硬数字，会参与跨语言一致性校验（DESIGN 10.2） */
  score: z.string().min(1).optional(),
})

const certificateItem = z.strictObject({
  name: localizedString,
  issuer: z.string().min(1).optional(),
  date: partialDate.optional(),
  score: z.string().min(1).optional(),
})

const awardItem = z.strictObject({
  title: localizedString,
  date: partialDate.optional(),
  awarder: z.string().min(1).optional(),
  summary: localizedString.optional(),
})

/**
 * B 级子树集中在这里。`contact` / `identity` 给 `{}` 默认值是安全的
 * （其子字段全为可选，`{}` 本身就是归一化结果）；
 * 但 `basics` 本身**不给默认值** —— 它含有带默认值的子字段，
 * 用 `.default({})` 会让默认值绕过子 schema 的归一化，导致 `parse` 不再幂等。
 * 代价是档案必须显式带上 `basics`（哪怕是个空对象），换来的是解析结果稳定。
 */
const basics = z.strictObject({
  name: localizedString.optional(),
  label: localizedString.optional(),
  summary: localizedString.optional(),
  url: z.string().min(1).optional(),
  picture: z.string().min(1).optional(),
  location: z
    .strictObject({
      city: z.string().min(1).optional(),
      region: z.string().min(1).optional(),
      countryCode: z.string().min(1).optional(),
      address: z.string().min(1).optional(),
    })
    .optional(),
  contact: z
    .strictObject({
      email: z.string().min(1).optional(),
      phone: z.string().min(1).optional(),
      wechat: z.string().min(1).optional(),
    })
    .default({}),
  identity: z
    .strictObject({
      idNumber: z.string().min(1).optional(),
      politicalStatus: z.string().min(1).optional(),
      nativePlace: z.string().min(1).optional(),
      birthDate: partialDate.optional(),
      gender: z.string().min(1).optional(),
    })
    .default({}),
  emergencyContact: z
    .strictObject({
      name: z.string().min(1).optional(),
      relation: z.string().min(1).optional(),
      phone: z.string().min(1).optional(),
    })
    .optional(),
  health: z.strictObject({ note: note.optional() }).optional(),
  family: z.strictObject({ note: note.optional() }).optional(),
  desiredSalary: z
    .strictObject({
      amount: z.number().nonnegative().optional(),
      currency: z.string().min(1).optional(),
    })
    .optional(),
  profiles: z.array(profileItem).default([]),
})

export const archiveV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  basics,
  work: z.array(workItem).default([]),
  education: z.array(educationItem).default([]),
  projects: z.array(projectItem).default([]),
  skills: z.array(skillItem).default([]),
  languages: z.array(languageItem).default([]),
  certificates: z.array(certificateItem).default([]),
  awards: z.array(awardItem).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
})

export type ArchiveV1 = z.infer<typeof archiveV1Schema>

/**
 * A / B 分级声明 —— 本文件里唯一需要人工维护的「语义」部分。
 *
 * 这里的每个键都必须在 `ArchiveV1` 上存在，少一个 `typecheck` 就不过（见 level.ts 的 LevelSpec）。
 * 原则：**级别统一的子树给一个字符串，级别混合的子树才展开** ——
 * 分级表的粒度只需要细到「出网时该剥掉哪一块」，再细就是噪音。
 */
const archiveV1Levels = {
  schemaVersion: 'A',
  basics: {
    name: 'B',
    label: 'A',
    summary: 'A',
    url: 'B',
    picture: 'B',
    location: 'B',
    contact: 'B',
    identity: 'B',
    emergencyContact: 'B',
    health: 'B',
    family: 'B',
    desiredSalary: 'B',
    profiles: 'B',
  },
  work: 'A',
  education: 'A',
  projects: 'A',
  skills: 'A',
  languages: 'A',
  certificates: 'A',
  awards: 'A',
  customFields: 'B',
} as const satisfies LevelSpec<ArchiveV1>

export const archiveV1Policies: readonly FieldPolicy[] = Object.freeze(
  collectFieldPolicies(archiveV1Levels),
)

/** 一份结构完整但内容为空的档案 —— 新用户开箱、以及迁移兜底都用它。 */
export function emptyArchiveV1(): ArchiveV1 {
  return archiveV1Schema.parse({ schemaVersion: 1, basics: {} })
}
