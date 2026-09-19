/**
 * 保存下来的表单 HTML fixture（T5.1）。
 *
 * 以 TS 字符串模块而不是 `.html` 文件存放，原因有两个：
 *   1. extension 的 tsconfig 是 `lib: ["ES2023"] + types: []`（零环境类型），
 *      测试里引 `node:fs` 读文件会破坏这条约束 —— HTML 解析交给 jsdom，
 *      文件读取则没有必要存在。
 *   2. fixture 内容直接暴露在 diff 里，改一个标签，测试期望跟着红，
 *      不存在「文件被谁改了但测试不知道」的缝。
 *
 * 这些页面都是**虚构**的（T5.2 才引入真实站点快照）：四个表单各测一件事 ——
 *   - `GENERIC_FORM`       长尾站点的常规表单，启发式匹配的主战场（20 个字段）
 *   - `AMBIGUOUS_FORM`     两个同标签字段制造真正的歧义（歧义 = 都不填）
 *   - `MOCKBOARD_FORM`     带平台标记的虚构站点，验证适配器命中 + 启发式兜底混跑
 *   - `DEGRADED_FORM`      平台改版（选择器全部失效），验证「快速降级到启发式」
 */

export const GENERIC_FORM_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<form id="apply-form">
  <label for="f-name">姓名 <span class="required">*</span></label>
  <input id="f-name" name="fullname" type="text">

  <input id="f-intent" name="job_intent" type="text" aria-label="求职意向">

  <label for="f-phone">手机号 <span class="required">*</span></label>
  <input id="f-phone" name="mobile" type="tel">

  <label for="f-email">电子邮箱</label>
  <input id="f-email" name="mail" type="email">

  <label for="f-wechat">微信号</label>
  <input id="f-wechat" name="wechat" type="text">

  <label for="f-gender">性别</label>
  <select id="f-gender" name="gender">
    <option value="">请选择</option>
    <option value="M">男</option>
    <option value="F">女</option>
  </select>

  <label for="f-birth">出生日期</label>
  <input id="f-birth" name="birthday" type="date">

  <label for="f-degree">最高学历</label>
  <select id="f-degree" name="degree">
    <option value="">请选择</option>
    <option value="associate">专科</option>
    <option value="bachelor">本科</option>
    <option value="master">硕士</option>
  </select>

  <label for="f-school">毕业院校</label>
  <input id="f-school" name="university" type="text">

  <label for="f-major">专业</label>
  <input id="f-major" name="major" type="text" placeholder="如：计算机科学与技术">

  <label for="f-graduate">毕业时间</label>
  <input id="f-graduate" name="graduation" type="month">

  <label for="f-city">期望工作城市</label>
  <select id="f-city" name="city">
    <option value="">请选择</option>
    <option value="beijing">北京</option>
    <option value="shanghai">上海</option>
    <option value="shenzhen">深圳</option>
  </select>

  <label for="f-salary">期望月薪</label>
  <input id="f-salary" name="salary" type="number">

  <label for="f-intro">自我介绍</label>
  <textarea id="f-intro" name="intro" rows="4"></textarea>

  <label for="f-tel-1">备用联系电话</label>
  <input id="f-tel-1" name="tel1" type="tel">

  <label for="f-tel-2">备用联系电话</label>
  <input id="f-tel-2" name="tel2" type="tel">

  <label for="f-emergency">紧急联系人电话 <span class="required">*</span></label>
  <input id="f-emergency" name="emergency_phone" type="tel">

  <label for="f-captcha">验证码</label>
  <input id="f-captcha" name="captcha" type="text" maxlength="4" required>

  <label for="f-resume-upload">上传简历附件</label>
  <input id="f-resume-upload" name="resume" type="file">

  <label><input type="checkbox" name="agreement"> 我已阅读并同意《隐私政策》</label>

  <input type="hidden" name="csrf" value="token">
  <button type="submit">提交申请</button>
</form>
</body></html>`

export const AMBIGUOUS_FORM_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<form>
  <label for="a-tel-1">联系电话</label>
  <input id="a-tel-1" name="tel_a" type="tel">

  <label for="a-tel-2">联系电话</label>
  <input id="a-tel-2" name="tel_b" type="tel">

  <label for="a-email">电子邮箱</label>
  <input id="a-email" name="mail" type="email">
</form>
</body></html>`

export const MOCKBOARD_FORM_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<form data-platform="mockboard">
  <input id="mb-name" name="candidate_name" type="text">

  <input id="mb-phone" name="phone_number" type="tel">

  <input id="mb-email" name="mail" type="email" class="mb-email">

  <input id="mb-intent" name="job_intent" type="text" aria-label="求职意向">

  <label for="mb-degree">最高学历</label>
  <select id="mb-degree" name="degree">
    <option value="">请选择</option>
    <option value="bachelor">本科</option>
    <option value="master">硕士</option>
  </select>

  <button type="submit">投递</button>
</form>
</body></html>`

export const DEGRADED_FORM_HTML = `<!doctype html>
<html lang="zh-CN"><body>
<form data-platform="brokenboard">
  <label for="d-name">姓名 <span class="required">*</span></label>
  <input id="d-name" name="fullname" type="text">

  <label for="d-phone">手机号</label>
  <input id="d-phone" name="mobile" type="tel">
</form>
</body></html>`
