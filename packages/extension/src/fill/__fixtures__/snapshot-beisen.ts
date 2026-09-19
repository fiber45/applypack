/**
 * 北森（beisen）校招申请表快照 · v1（手工建模的近似快照，见 README「适配器与快照维护」）。
 *
 * 建模依据是北森校招表单的**真实结构特征**，不是随便编的：
 *   - 控件 `id` 是部署期随机串（`txt_8f3a2c1e`），跨公司、跨版本都不同；
 *   - 字段标题是普通 `span`，**不是** `label` 元素 —— 提取层的
 *     `collectLabels` 看不见它，页面上唯一的文案线索是 placeholder；
 *   - placeholder 统一是「请输入……」句式 —— 「姓名」与「姓名拼音」
 *     只差两个字，纯启发式对 `basics.name.zh` 打平成歧义；
 *   - 性别是 radio 组，题干在 `aria-labelledby` 指向的 span 上。
 *
 * 这些特征正是适配器存在的理由：选择器按 v1 快照的 placeholder /
 * name 结构钉住高危字段，版本纪律（data-platform-version）保证
 * 平台改版后必须重新采集才能继续用。
 */
export const BEISEN_SNAPSHOT_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<div id="applyForm" data-platform="beisen" data-platform-version="1">
  <div class="field-row">
    <span class="field-label"><i class="required">*</i> 姓名</span>
    <input id="txt_8f3a2c1e" name="ctl00$main$field0" type="text" placeholder="请输入姓名" required>
  </div>
  <div class="field-row">
    <span class="field-label">姓名拼音</span>
    <input id="txt_9c1d4b7a" name="ctl00$main$field1" type="text" placeholder="请输入姓名拼音">
  </div>
  <div class="field-row">
    <span class="field-label"><i class="required">*</i> 手机号</span>
    <input id="txt_b2e7f0d3" name="ctl00$main$field2" type="tel" placeholder="请输入手机号" required>
  </div>
  <div class="field-row">
    <span class="field-label">备用联系电话</span>
    <input id="txt_a6c5e8f2" name="ctl00$main$field3" type="tel" placeholder="请输入备用联系电话">
  </div>
  <div class="field-row">
    <span class="field-label">电子邮箱</span>
    <input id="txt_c4d9e1b6" name="ctl00$main$field4" type="email" placeholder="请输入邮箱">
  </div>
  <div class="field-row">
    <span class="field-label" id="lb_beisen_gender">性别</span>
    <label><input type="radio" name="rdoGender" value="1" aria-labelledby="lb_beisen_gender">男</label>
    <label><input type="radio" name="rdoGender" value="2" aria-labelledby="lb_beisen_gender">女</label>
  </div>
  <div class="field-row">
    <span class="field-label"><i class="required">*</i> 最高学历</span>
    <select id="sel_5e2f8a9c" name="ctl00$main$field6" required>
      <option value="">请选择</option>
      <option value="2">大专</option>
      <option value="3">本科</option>
      <option value="6">硕士</option>
    </select>
  </div>
  <div class="field-row">
    <span class="field-label">自我介绍</span>
    <textarea id="txt_e8b2c4d7" name="ctl00$main$field7" placeholder="请输入自我介绍"></textarea>
  </div>
  <div class="field-row">
    <span class="field-label"><i class="required">*</i> 身份证号</span>
    <input id="txt_f1a9b3c8" name="ctl00$main$field8" type="text" placeholder="请输入身份证号码" required>
  </div>
  <div class="field-row">
    <span class="field-label"><i class="required">*</i> 附件简历</span>
    <input id="file_7d2c1b8e" name="resumeUpload" type="file" required>
  </div>
  <input type="hidden" name="csrf_token" value="snapshot">
  <button type="submit">提交申请</button>
</div>
</body></html>`
