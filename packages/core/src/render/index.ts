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
 *
 * 五个子模块各有一句话职责：
 *
 * - `model` —— 排版无关的文档结构（T4a）
 * - `layout` / `paginate` —— 版式常量与页数估算（T4b，「EN 版 1 页」的执行者）
 * - `package` —— 一次产出三版 + 交付前检查（T4b）
 * - `filename` / `format` —— 命名规范与形态规范（T4c）
 */

export {
  extractLines,
  extractText,
  lineOf,
  missingFields,
} from './ats'
export { decodeEntities, escapeHtml } from './escape'
export {
  DEFAULT_FILE_STEM,
  DELIVERY_EXTENSION,
  DELIVERY_FILE_NAME_PATTERN,
  MAX_FILE_STEM_LENGTH,
  VIEW_SUFFIXES,
  checkFileName,
  checkFileNames,
  deliveryFileName,
  isDeliveryFileName,
  resolveNaming,
  sanitizeFileStem,
  type FileNameProblem,
  type FileNameProblemReason,
  type NamingReport,
  type ViewSuffix,
} from './filename'
export {
  normalizeCss,
  scanForbiddenLayout,
  splitTexts,
  stitchReport,
  styleSurface,
  type LayoutViolation,
  type StitchMismatch,
  type StitchReport,
} from './format'
export {
  FORBIDDEN_CSS_DECLARATIONS,
  FORBIDDEN_LAYOUT_PATTERNS,
  FORBIDDEN_MARKUP,
  RESUME_STYLES,
  renderBilingualHtml,
  renderBody,
  renderHtml,
} from './html'
export {
  CAMPUS_LAYOUT,
  MM_PER_PT,
  type BlockKind,
  type BlockStyle,
  type LayoutSpec,
  type PageSpec,
} from './layout'
export {
  buildDocumentModel,
  // 一条条目在页面上占的全部文本行。**三个消费者共用它**：HTML 渲染、
  // 页数估算、以及 Web 端的 PDF 模板（T4a 补齐的那一半）。
  // 它当初被刻意做成公开的单一产地，就是为了让「PDF 少印了一行」这类漂移
  // 没有可以发生的地方 —— 所以 T4a 把它加进导出面，而不是在 PDF 模板里
  // 再拼一次 `keywordLine + bullets`。
  entryLines,
  pickLang,
  type BuildDocumentOptions,
  type ContactLine,
  type DocumentEntry,
  type DocumentModel,
  type DocumentSection,
  type RenderLang,
  type RenderTarget,
} from './model'
export {
  buildDeliveryPackage,
  checkPackage,
  crossLanguageParity,
  type CrossLanguageParity,
  type DeliveryPackage,
  type DeliveryPackageOptions,
  type DeliveryPackageViews,
  type PackageCheck,
  type PackageFailure,
  type PackageFailureReason,
  type PackageView,
  type PackageViewName,
  type ViewModels,
} from './package'
export {
  BLOCK_LABELS,
  advanceEm,
  bodyLinePt,
  columnHeightPt,
  columnWidthPt,
  estimatePages,
  layoutBlocks,
  wrappedLines,
  type BlockCost,
  type PageEstimate,
} from './paginate'
