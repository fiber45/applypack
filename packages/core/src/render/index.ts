/**
 * `core/render` —— 管线第 7 步（渲染导出），纯确定性。
 *
 * 这是**唯一允许 B 级数据进入产出物**的模块。它与 `core/egress` 构成一组对照：
 *
 *   egress：A 级可以出网，B 级只被丢弃
 *   render：B 级必须被逐字写进产物（简历上要印姓名与电话），且从不经过模型
 *
 * 两条线合起来，构成了 DESIGN 1.3 那句判据的完整实现：
 * 「上简历」和「进模型请求」是两件事，B 级管的是后者。
 */

export {
  extractLines,
  extractText,
  lineOf,
  missingFields,
} from './ats'
export { decodeEntities, escapeHtml } from './escape'
export { FORBIDDEN_LAYOUT_PATTERNS, renderHtml } from './html'
export {
  buildDocumentModel,
  pickLang,
  type BuildDocumentOptions,
  type ContactLine,
  type DocumentEntry,
  type DocumentModel,
  type DocumentSection,
  type RenderLang,
  type RenderTarget,
} from './model'
