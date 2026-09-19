/**
 * T8.4 导出交付 —— 交付哪些文件、文件名是什么、内容从哪来。
 *
 * ## 三个单一产地，一个都不许在这里重拼
 *
 * - **文件名**：PDF 名出自 core 的 `deliveryFileName`（`Resume_CN.pdf` /
 *   `Resume_EN.pdf`，与扩展端上传槽位的建议文件名是同一个函数）；
 * - **内容**：PDF 由注入的 `renderPdf` 渲染**预览同源的 HTML** ——
 *   预览看到什么，导出就是什么；自述文本取自 `buildPreviewModel`
 *   的同一批视图；
 * - **失败语义**：任一文件渲染失败，整次交付上抛 —— 「下了一半」
 *   不能长得像成功（保存失败被吞的镜像谎言，见 T7.4 注记）。
 *
 * 自述文本的文件名（`Resume_Intro_ZH.txt`）是本模块的约定：core 没有
 * 「自述文件名」这个概念，这里立一条最小约定并钉进测试，防止 UI 层
 * 各写各的。
 */

import { DEFAULT_FILE_STEM, deliveryFileName } from '../../../../core/src/render/index'
import type { ArchiveV1 } from '../../../../core/src/schema/index'
import { buildPreviewModel } from './model'

export type FileSink = (fileName: string, content: string | Blob) => void

/** PDF 渲染接缝：UI 接线时传 `renderViewToBlob` 的 HTML 版本。 */
export type PdfRenderer = (html: string) => Promise<Blob>

export function introTextFileName(lang: 'ZH' | 'EN'): string {
  return `${DEFAULT_FILE_STEM}_Intro_${lang}.txt`
}

/**
 * 交付全部文件。顺序：中文 PDF → 英文 PDF → 中文自述 → 英文自述。
 * 返回交付的文件名列表（顺序即交付顺序）。
 */
export async function deliverAll(
  archive: ArchiveV1,
  sink: FileSink,
  renderPdf: PdfRenderer,
): Promise<readonly string[]> {
  const preview = buildPreviewModel(archive)
  const cnName = deliveryFileName(DEFAULT_FILE_STEM, 'CN')
  const enName = deliveryFileName(DEFAULT_FILE_STEM, 'EN')

  // 先全部渲染、后全部落盘？不。**渲染失败立刻上抛**比「收集齐再写」
  // 更诚实：后者的「要么全有要么全无」是假象 —— sink 已经写出去的
  // 文件收不回来。这里选择「逐个写、失败即停」，并把语义如实告诉调用方。
  sink(cnName, await renderPdf(preview.cnHtml))
  sink(enName, await renderPdf(preview.enHtml))

  const zhIntro = preview.intros.find((v) => v.target.lang === 'zh')
  const enIntro = preview.intros.find((v) => v.target.lang === 'en')
  const names: string[] = [cnName, enName]
  if (zhIntro !== undefined) {
    const name = introTextFileName('ZH')
    sink(name, zhIntro.text)
    names.push(name)
  }
  if (enIntro !== undefined) {
    const name = introTextFileName('EN')
    sink(name, enIntro.text)
    names.push(name)
  }
  return names
}
