/**
 * 大易（dayee）申请表快照 · v1（手工建模的近似快照，见 README「适配器与快照维护」）。
 *
 * 大易的真实结构特征：
 *   - 控件 `name` 是稳定的 `p_*` 风格（`p_mobile`），是选择器的可靠锚点；
 *   - select 的 option `value` 常是**中文本身**（`value="本科"`），
 *     与北森/Moka 的数字码不同 —— 回填值跟着站点走；
 *   - 「毕业时间」是**年份下拉**（2024/2025/2026），而档案存的是
 *     `2024-06` —— DESIGN 234 说的「毕业时间 vs 毕业年月」术语缝，
 *     由 option-mismatch 缺口兜住，不硬猜；
 *   - 「紧急联系人电话」与「手机号码」对 `basics.contact.phone` 的
 *     启发式得分打平（都是包含命中 6 分）—— 纯启发式在快照上
 *     会把两个都留成歧义，适配器钉住 `p_mobile` 解围。
 */
export const DAYEE_SNAPSHOT_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<form id="applyForm" data-platform="dayee" data-platform-version="1">
  <div class="tr">
    <label for="p_name">姓名 <span class="req">*</span></label>
    <input id="p_name" name="p_name" type="text" required>
  </div>
  <div class="tr">
    <span class="th" id="sexLabel">性别</span>
    <label><input id="p_sex_0" name="p_sex" type="radio" value="0" aria-labelledby="sexLabel">男</label>
    <label><input id="p_sex_1" name="p_sex" type="radio" value="1" aria-labelledby="sexLabel">女</label>
  </div>
  <div class="tr">
    <label for="p_mobile">手机号码 <span class="req">*</span></label>
    <input id="p_mobile" name="p_mobile" type="tel" required>
  </div>
  <div class="tr">
    <label for="p_contact_tel">紧急联系人电话</label>
    <input id="p_contact_tel" name="p_contact_tel" type="tel">
  </div>
  <div class="tr">
    <label for="p_email">邮箱 <span class="req">*</span></label>
    <input id="p_email" name="p_email" type="email" required>
  </div>
  <div class="tr">
    <label for="p_education">学历</label>
    <select id="p_education" name="p_education">
      <option value="">请选择</option>
      <option value="大专">大专</option>
      <option value="本科">本科</option>
      <option value="硕士">硕士</option>
    </select>
  </div>
  <div class="tr">
    <label for="p_graduate">毕业时间 <span class="req">*</span></label>
    <select id="p_graduate" name="p_graduate" required>
      <option value="">请选择</option>
      <option value="2024">2024</option>
      <option value="2025">2025</option>
      <option value="2026">2026</option>
    </select>
  </div>
  <div class="tr">
    <label for="p_salary">期望薪资（元/月）</label>
    <input id="p_salary" name="p_salary" type="text">
  </div>
  <div class="tr">
    <label for="p_intro">自我介绍</label>
    <textarea id="p_intro" name="p_intro"></textarea>
  </div>
  <div class="tr">
    <label for="p_resume">附件简历 <span class="req">*</span></label>
    <input id="p_resume" name="p_resume" type="file" required>
  </div>
  <div class="tr">
    <label for="p_note">备注</label>
    <textarea id="p_note" name="p_note"></textarea>
  </div>
  <input type="hidden" name="jobid" value="12345">
  <button type="submit">投递简历</button>
</form>
</body></html>`
