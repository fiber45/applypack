/**
 * T8.3 预览模型 —— 档案 → 简历双语 HTML + 自述文本。
 *
 * ## 全是接线，没有发明
 *
 * 简历 HTML 出自 core 的 `buildDeliveryPackage`（T4a 交付包的同一产地，
 * 含页数/命名/跨语言一致性检查），自述出自 `buildIntroViews`（T4b）。
 * 本模块只做一次「面向 UI 的取材投影」：UI 想画预览，从**这里**拿
 * 数据，而不是自己再去 core 拼一遍 —— 拼两遍的结局是预览与导出
 * 各说各话。
 *
 * ## 确定性不是巧合
 *
 * core 的渲染链是纯函数（无 Date.now、无随机），同一档案两次构建
 * 逐字节一致 —— `model.test.ts` 钉住这一点，让「预览随档案变化」
 * 的 UI 契约有可验证的地基。
 */

import { buildDeliveryPackage } from '../../../../core/src/render/index'
import { buildIntroViews, type IntroView } from '../../../../core/src/intro/index'
import type { ArchiveV1 } from '../../../../core/src/schema/index'

export interface PreviewModel {
  /** 中文简历 HTML（`views.cn`，同 T4a 交付包产地）。 */
  readonly cnHtml: string
  /** 英文简历 HTML（`views.en`）。 */
  readonly enHtml: string
  /** 自述视图（T4b 的档位视图，含 skipped 解释）。 */
  readonly intros: readonly IntroView[]
}

export function buildPreviewModel(archive: ArchiveV1): PreviewModel {
  const pkg = buildDeliveryPackage(archive)
  // 幻觉数字检测（T4b check）需要简历文本层 —— 取自同一份交付包的
  // `views.*.texts`（渲染产物的真实文本行，core 注释原文：校验的输入
  // 是它，不是模型）。预览与校验因此读同一页面的同一份文本。
  const intro = buildIntroViews(archive, {
    resumeTexts: { zh: pkg.views.cn.texts, en: pkg.views.en.texts },
  })
  return {
    cnHtml: pkg.views.cn.html,
    enHtml: pkg.views.en.html,
    intros: intro.views,
  }
}
