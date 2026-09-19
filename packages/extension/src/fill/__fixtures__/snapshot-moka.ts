/**
 * Moka 申请表快照 · v1（手工建模的近似快照，见 README「适配器与快照维护」）。
 *
 * Moka 的真实结构特征：
 *   - 控件 `id` 带 uid 段（`field-a1b2c3`），每次构建都可能变 ——
 *     选择器不能钉 id，要钉 `data-moka-field` 这种语义属性；
 *   - label 关联是**标准**的（`label[for]`），所以启发式在 Moka 上
 *     命中率本来就高 —— 适配器只钉少数高危字段，其余放给启发式；
 *   - 一个真实的小坑：email 字段的 `type` 是 `text` 不是 `email`
 *     （本快照照实建模）—— 评分器的类型闸门放行 text，仍可匹配。
 *
 * 与北森快照形成对照：适配器不是越全越好，平台越规范，
 * 启发式兜底占比越大。
 */
export const MOKA_SNAPSHOT_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<div id="root" data-platform="moka" data-platform-version="1">
  <div class="form-item">
    <label for="field-a1b2c3">姓 名 <span class="star">*</span></label>
    <input id="field-a1b2c3" data-moka-field="name" name="name" type="text" required>
  </div>
  <div class="form-item">
    <label for="field-d4e5f6">手机号码 <span class="star">*</span></label>
    <input id="field-d4e5f6" data-moka-field="phone" name="phone" type="tel" required>
  </div>
  <div class="form-item">
    <label for="field-g7h8i9">电子邮箱</label>
    <input id="field-g7h8i9" data-moka-field="email" name="email" type="text">
  </div>
  <div class="form-item">
    <label for="field-j1k2l3">微信（选填）</label>
    <input id="field-j1k2l3" name="wechat" type="text">
  </div>
  <div class="form-item">
    <label for="field-m4n5o6">期望工作城市 <span class="star">*</span></label>
    <select id="field-m4n5o6" name="city" required>
      <option value="">请选择</option>
      <option value="beijing">北京</option>
      <option value="shanghai">上海</option>
      <option value="chengdu">成都</option>
      <option value="shenzhen">深圳</option>
    </select>
  </div>
  <div class="form-item">
    <label for="field-p7q8r9">最高学历 <span class="star">*</span></label>
    <select id="field-p7q8r9" name="degree" required>
      <option value="">请选择</option>
      <option value="2">大专</option>
      <option value="4">本科</option>
      <option value="6">硕士</option>
    </select>
  </div>
  <div class="form-item">
    <label for="field-s1t2u3">学校名称</label>
    <input id="field-s1t2u3" name="school" type="text">
  </div>
  <div class="form-item">
    <label for="field-v4w5x6">期望月薪（元/月）</label>
    <input id="field-v4w5x6" name="salary" type="number">
  </div>
  <div class="form-item">
    <label for="field-y7z8a9">个人简介</label>
    <textarea id="field-y7z8a9" name="summary"></textarea>
  </div>
  <div class="form-item">
    <label for="field-b1c2d3">您从哪里得知本次招聘机会</label>
    <select id="field-b1c2d3" name="channel">
      <option value="">请选择</option>
      <option value="referral">内推</option>
      <option value="jobboard">招聘网站</option>
      <option value="campus">校园宣讲</option>
    </select>
  </div>
  <div class="form-item">
    <label for="field-e4f5g6">附件简历 <span class="star">*</span></label>
    <input id="field-e4f5g6" name="attachment" type="file" required>
  </div>
  <div class="form-item">
    <label for="field-h7i8j9">补充材料</label>
    <input id="field-h7i8j9" name="extra" type="file">
  </div>
  <label class="agree"><input type="checkbox" name="privacy"> 我已阅读并同意《隐私政策》</label>
</div>
</body></html>`
