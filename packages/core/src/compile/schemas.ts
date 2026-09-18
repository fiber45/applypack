/**
 * 编译产物的 schema —— 严格模式。
 *
 * DESIGN 8.3：「结构化输出用 schema，不用自然语言要求」（自然语言要求约 3–5% 返回坏 JSON）。
 * 而这里要补一句更重要的：**schema 本身就是设计文档。**
 *
 * 看 `jdSkillSchema.evidence` 与 `compiledEntrySchema.numbers` 这两个字段 ——
 * 任何人读到这里立刻明白这个系统在做事实溯源。字段名选得好，比写一段
 * 「请确保不要编造数字」的 prompt 有效得多：前者是模型**必须填**的结构位，
 * 后者是一句它可以选择性忽略的请求。
 *
 * 全部用 `strictObject`（ADR-8）：未知字段直接报错，而不是静默丢弃。
 * 理由见 DESIGN 1.3 —— 未知字段没有级别，因而无法参与 B 级不出网判定。
 */

import { z } from 'zod'

/** 岗位硬门槛的类别。`other` 是逃生口，但必须带原文，避免变成模型自由发挥的垃圾桶。 */
export const jdRequirementSchema = z.strictObject({
  kind: z.enum(['degree', 'major', 'graduation', 'language', 'certificate', 'location', 'other']),
  /** 门槛的原文表述，逐字取自 JD */
  text: z.string().min(1),
  /**
   * 「必须」还是「加分」。
   * 这不只是措辞差别：硬门槛用于筛选（不符合直接出局），加分项只影响排序。
   * 把「有相关实习经验者优先」读成硬门槛，会让用户白丢一批本可以投的岗位。
   */
  strict: z.boolean(),
})

export const jdSkillSchema = z.strictObject({
  /** 技能名，保留 JD 里的写法（"推荐系统" 而不是 "Recommender Systems"） */
  name: z.string().min(1),
  /** 程度词，决定匹配时的权重 */
  proficiency: z.enum(['expert', 'proficient', 'familiar']),
  /** 是否为必备技能 —— 与 `proficiency` 是两件事：可以「熟悉」但是必备 */
  required: z.boolean(),
  /** 该技能在 JD 中的原始依据句。留空即视为模型自由发挥，闸门会拦。 */
  evidence: z.string().min(1),
})

export const compiledJdSchema = z.strictObject({
  /** 岗位名称 */
  title: z.string().min(1),
  /** 公司名。JD 里常常没写，允许缺失 */
  company: z.string().nullable(),
  hardRequirements: z.array(jdRequirementSchema),
  skills: z.array(jdSkillSchema),
  /** 职责描述，保留原文，用于改写时的语义对齐 */
  responsibilities: z.array(z.string().min(1)),
  /** 语域：决定改写时的用词风格（校招 JD 与资深岗 JD 的措辞差别极大） */
  register: z.enum(['formal', 'technical', 'business', 'casual']),
  /** JD 的语种。中英混合的 JD 在外企很常见，需要单独一档 */
  language: z.enum(['zh', 'en', 'mixed']),
})

export type JdRequirement = z.infer<typeof jdRequirementSchema>
export type JdSkill = z.infer<typeof jdSkillSchema>
export type CompiledJd = z.infer<typeof compiledJdSchema>

/** 经历条目。`sourceText` 是这一层最重要的字段。 */
export const compiledEntrySchema = z.strictObject({
  kind: z.enum(['work', 'project', 'education', 'award', 'certificate', 'other']),
  /** 职位 / 项目名 / 学位 */
  title: z.string().min(1),
  /** 公司 / 学校 / 颁发机构 */
  organization: z.string().min(1),
  /** 起止时间，`YYYY-MM`。缺失时用 null —— 不用空字符串（空串与「缺失」在排序里是两种行为） */
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  /**
   * **逐字保留的原始描述，未经任何改写。**
   *
   * DESIGN 8.2 说「绝不『先总结再改写』—— 原始数字一旦在预处理阶段丢失，
   * 幻觉校验就永远失效」。这个字段就是那句话的落地点：它随条目一路带到
   * 改写层，成为 `untraceableNumbers` 的唯一来源。
   * 一旦这里存的是模型的摘要而不是原文，整条溯源链当场断掉 —— 而且是静默断掉。
   */
  sourceText: z.string().min(1),
  /** 从 `sourceText` 中抽出的数字。编译层的闸门会核对它确实来自 sourceText。 */
  numbers: z.array(z.string()),
})

export const compiledExperienceSchema = z.strictObject({
  entries: z.array(compiledEntrySchema),
})

export type CompiledEntry = z.infer<typeof compiledEntrySchema>
export type CompiledExperience = z.infer<typeof compiledExperienceSchema>
