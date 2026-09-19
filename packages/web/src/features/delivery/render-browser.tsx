/**
 * 浏览器侧的渲染入口（应用用）。
 *
 * `pdf(...).toBlob()` 而不是 `renderToBuffer`：后者是 Node 专用导出，
 * 浏览器构建里没有。见 `render-node.tsx` 的文件头。
 */

import { pdf } from '@react-pdf/renderer'
import type { PackageView } from '../../../../core/src/render/index'
import { DeliveryDocument } from './document'

/** 渲染一版投递包为可下载的 Blob。 */
export async function renderViewToBlob(view: PackageView): Promise<Blob> {
  return await pdf(<DeliveryDocument view={view} />).toBlob()
}
