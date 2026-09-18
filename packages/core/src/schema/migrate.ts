import { archiveV1Schema, type ArchiveV1 } from './archive'
import { archiveV0Schema } from './v0'
import { describeZodIssues } from './zod-issues'

/**
 * 档案迁移 —— **唯一的**「旧数据 → 新数据」通路。
 *
 * 三条不可让步的规则：
 *
 * 1. **迁移不编造内容。** 尤其不得顺手把中文翻译成英文 ——
 *    v0 的单语言字段只能落到 `zh`，`en` 必须留空。
 *    缺的那一版由「信息缺口闭环」（DESIGN 11）在生成时提示用户补，
 *    而不是由迁移函数替用户决定英文怎么写。
 * 2. **迁移不丢内容。** 迁移前后逐条比对 bullet 文本，是测试里的一条硬断言。
 * 3. **不确定就报错。** 版本号不认识、旧数据不合规，一律抛 `MigrationError`。
 *    半份档案比一次失败危险得多。
 *
 * 因为 v1 是严格模式，任何形状变更都必须同时 bump `schemaVersion` 并在这里加一段迁移 ——
 * 严格模式让「忘了写迁移」变成一个无法被忽略的硬错误。
 */

export const CURRENT_SCHEMA_VERSION = 1

export class MigrationError extends Error {
  readonly issues: readonly string[]

  constructor(message: string, issues: readonly string[] = []) {
    super(issues.length === 0 ? message : `${message}：${issues.join('；')}`)
    this.name = 'MigrationError'
    this.issues = issues
  }
}

/**
 * 入口：接受任意未知输入，产出合法 v1 档案，或抛出 `MigrationError`。
 *
 * 幂等 —— 已是 v1 的档案原样通过（只做一次校验），因此可以安全地重复调用。
 */
export function migrateArchive(input: unknown): ArchiveV1 {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new MigrationError('档案必须是对象')
  }

  const record = input as Record<string, unknown>
  const schemaVersion = record['schemaVersion']

  if (schemaVersion === CURRENT_SCHEMA_VERSION) {
    const parsed = archiveV1Schema.safeParse(input)
    if (!parsed.success) {
      throw new MigrationError('已是 v1，但不通过 v1 校验', describeZodIssues(parsed.error))
    }
    return parsed.data
  }

  if (schemaVersion !== undefined) {
    throw new MigrationError(
      `不支持的 schemaVersion：${String(schemaVersion)}（当前支持 ${CURRENT_SCHEMA_VERSION}）`,
    )
  }

  if (record['version'] === 0) {
    return migrateV0ToV1(input)
  }

  throw new MigrationError('无法识别的档案版本：既无 schemaVersion，version 也不是 0')
}

/** 单语言字符串 → 只填中文槽位。`en` 留给缺口闭环，不在这里猜。 */
function toLocalizedZh(text: string | undefined): { zh: string } | undefined {
  return text === undefined ? undefined : { zh: text }
}

/**
 * 递归剔除值为 `undefined` 的键。
 *
 * 为什么需要它：迁移是把字段「搬家」，中间态里有大量 `undefined`。
 * 直接 JSON 序列化虽然也会丢掉 undefined，但那会连 `undefined` 的数组元素一起变成 `null`，
 * 属于把问题推到下游 —— 这里显式剔除，让非法状态在读代码时就能看见。
 */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneUndefined(item)) as T
  }
  if (value !== null && typeof value === 'object') {
    const pruned: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined) pruned[key] = pruneUndefined(item)
    }
    return pruned as T
  }
  return value
}

function migrateV0ToV1(input: unknown): ArchiveV1 {
  const parsed = archiveV0Schema.safeParse(input)
  if (!parsed.success) {
    throw new MigrationError('v0 档案不通过 v0 校验', describeZodIssues(parsed.error))
  }
  const v0 = parsed.data

  const candidate = pruneUndefined({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    basics: {
      name: toLocalizedZh(v0.name),
      label: toLocalizedZh(v0.title),
      summary: toLocalizedZh(v0.summary),
      url: v0.website,
      location: { city: v0.city },
      contact: { email: v0.email, phone: v0.phone },
      identity: {
        idNumber: v0.idNumber,
        politicalStatus: v0.politicalStatus,
        nativePlace: v0.nativePlace,
        birthDate: v0.birthDate,
        gender: v0.gender,
      },
      profiles:
        v0.github === undefined
          ? []
          : [
              {
                network: 'GitHub',
                username: v0.github,
                url: `https://github.com/${v0.github}`,
              },
            ],
    },
    work: v0.experiences.map((item) => ({
      company: item.company,
      position: toLocalizedZh(item.role),
      startDate: item.start,
      endDate: item.end,
      location: item.location,
      highlights: item.bullets,
    })),
    education: v0.educations.map((item) => ({
      institution: item.school,
      area: toLocalizedZh(item.major),
      studyType: toLocalizedZh(item.degree),
      startDate: item.start,
      endDate: item.end,
      gpa: item.gpa,
      highlights: item.highlights,
    })),
    projects: v0.projects.map((item) => ({
      name: toLocalizedZh(item.name),
      description: toLocalizedZh(item.description),
      highlights: item.highlights,
      startDate: item.start,
      endDate: item.end,
    })),
    skills: v0.skills.map((name) => ({ name: toLocalizedZh(name) })),
    certificates: v0.certificates.map((item) => ({
      name: toLocalizedZh(item.name),
      issuer: item.issuer,
      date: item.date,
      score: item.score,
    })),
    awards: v0.awards.map((item) => ({
      title: toLocalizedZh(item.title),
      date: item.date,
      awarder: item.awarder,
    })),
    customFields: {},
  })

  const result = archiveV1Schema.safeParse(candidate)
  if (!result.success) {
    throw new MigrationError(
      'v0 → v1 迁移产出的档案不通过 v1 校验',
      describeZodIssues(result.error),
    )
  }
  return result.data
}
