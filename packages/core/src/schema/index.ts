/**
 * `@applypack/core/schema` —— 档案数据结构与 A / B 分级策略。
 *
 * 这一层是整套隐私叙事的地基：`neverSendToLLM` 不是注释，是**可被程序读取**的策略，
 * 出网组装层与测试层都从这里取判定，因此「哪些字段永不出端」只有一处真相。
 *
 * @see DESIGN.md 1.3 / 10.4 / 11.3 · AGENTS.md §5 §6
 */

export {
  archiveV1Policies,
  archiveV1Schema,
  emptyArchiveV1,
  type ArchiveV1,
} from './archive'

export { ArchiveDecodeError, deserializeArchive, serializeArchive } from './codec'

export {
  collectFieldPolicies,
  fieldPolicy,
  type DataLevel,
  type FieldPolicy,
  type LevelSpec,
} from './level'

export {
  CURRENT_SCHEMA_VERSION,
  MigrationError,
  migrateArchive,
} from './migrate'

export {
  aLevelPaths,
  bLevelPaths,
  fieldPolicies,
  fieldPolicyFor,
  getAtPath,
  isCoveredPath,
  listLeafPaths,
} from './policy'

export { archiveV0Schema, type ArchiveV0 } from './v0'

export { describeZodIssues } from './zod-issues'
