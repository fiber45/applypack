import { z } from 'zod'

/**
 * v0 档案 —— 项目的**历史形态**，只读，不再新增字段。
 *
 * 代表性特征，也正是迁移函数要处理的那几件事：
 *   - 单语言：所有文本都是裸字符串，没有 `i18n` 维度
 *   - 扁平：`experiences` / `educations` 与顶层同级，没有 `basics` 收纳身份信息
 *   - 无 `schemaVersion`：靠 `version: 0` 标识
 *   - 无 `customFields`：用户加字段只能自己往顶层塞
 *   - 技能是字符串数组，不是对象数组
 *
 * 保留这份 schema 的意义不只是「能读老数据」——
 * 它是迁移测试的输入契约：**只有先固定住旧形态，才能断言新形态没丢内容。**
 *
 * @see __fixtures__/archive-v0.sample.json 一份真实形态的历史样例
 */

const v0WorkItem = z.strictObject({
  company: z.string().min(1),
  role: z.string().min(1),
  start: z.string().min(1).optional(),
  end: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  bullets: z.array(z.string()).default([]),
})

const v0EducationItem = z.strictObject({
  school: z.string().min(1),
  major: z.string().min(1).optional(),
  degree: z.string().min(1).optional(),
  start: z.string().min(1).optional(),
  end: z.string().min(1).optional(),
  gpa: z.string().min(1).optional(),
  highlights: z.array(z.string()).default([]),
})

const v0ProjectItem = z.strictObject({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  highlights: z.array(z.string()).default([]),
  start: z.string().min(1).optional(),
  end: z.string().min(1).optional(),
})

const v0CertificateItem = z.strictObject({
  name: z.string().min(1),
  issuer: z.string().min(1).optional(),
  date: z.string().min(1).optional(),
  score: z.string().min(1).optional(),
})

const v0AwardItem = z.strictObject({
  title: z.string().min(1),
  date: z.string().min(1).optional(),
  awarder: z.string().min(1).optional(),
})

export const archiveV0Schema = z.strictObject({
  version: z.literal(0),
  name: z.string().min(1),
  title: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  gender: z.string().min(1).optional(),
  birthDate: z.string().min(1).optional(),
  idNumber: z.string().min(1).optional(),
  politicalStatus: z.string().min(1).optional(),
  nativePlace: z.string().min(1).optional(),
  website: z.string().min(1).optional(),
  github: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  experiences: z.array(v0WorkItem).default([]),
  educations: z.array(v0EducationItem).default([]),
  projects: z.array(v0ProjectItem).default([]),
  skills: z.array(z.string()).default([]),
  certificates: z.array(v0CertificateItem).default([]),
  awards: z.array(v0AwardItem).default([]),
})

export type ArchiveV0 = z.infer<typeof archiveV0Schema>
