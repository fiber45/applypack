/**
 * `core/compile` —— 管线的第 1、2 步（经历编译 / JD 编译）。
 *
 * 这是模型第一次被允许看到用户数据的地方，也是**唯一**允许看到的地方：
 * 所有出网都收口在 `core/egress`，而这里有 `archive` 参数的函数只有
 * `compileExperience` —— 且传进去的是 A 级投影，不是档案本身。
 *
 * @see DESIGN 3.3 的第 1、2 步 · AGENTS.md 红线 1 / 2
 */

export { CompileError } from './errors'
export {
  compileExperience,
  EXPERIENCE_SYSTEM_PROMPT,
  type CompileExperienceOptions,
} from './experience'
export { compileJd, JD_SYSTEM_PROMPT, type CompileJdOptions } from './jd'
export {
  extractJsonCandidate,
  parseStructured,
  type ParseFailure,
  type ParseFailureCode,
  type ParseResult,
} from './parse'
export { compileStructured, DEFAULT_MAX_ATTEMPTS, type CompileRequest } from './runner'
export {
  compiledEntrySchema,
  compiledExperienceSchema,
  compiledJdSchema,
  jdRequirementSchema,
  jdSkillSchema,
  type CompiledEntry,
  type CompiledExperience,
  type CompiledJd,
  type JdRequirement,
  type JdSkill,
} from './schemas'
