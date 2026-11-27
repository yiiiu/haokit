// 隐私说明页（功能或数据处理方式有变化时，记得同步修改这里并更新日期）
import { SITE } from '../assets/site.js';

const UPDATED = '2026 年 11 月 27 日';

// 服务器配置了 CF_ANALYTICS_TOKEN 时，页面里会有 Cloudflare 的统计脚本，这一段说明跟着切换
const analyticsEnabled = () => Boolean(document.querySelector('script[src*="cloudflareinsights.com"]'));

const ANALYTICS_ON = `
      <p>本站使用 Cloudflare Web Analytics 统计访问量和页面加载速度，用来了解哪些工具有人在用、页面打开快不快。</p>
      <ul>
        <li>统计的内容：访问的页面地址（不含问号后面的参数）、从哪个网站点进来、浏览器和设备类型、所在国家或地区（由 Cloudflare 根据 IP 判断），以及页面加载耗时。</li>
        <li>不统计的内容：你在工具里输入或粘贴的任何东西（账号、令牌、密钥、邮件）都不会发给统计服务。</li>
        <li>它不使用 Cookie。统计脚本从 static.cloudflareinsights.com 加载，数据发送到 cloudflareinsights.com，由 Cloudflare 按其隐私政策处理。</li>
      </ul>
      <p>为了让 Cloudflare 识别是哪个网站的访问，浏览器向它发送请求时会带上本站域名（不带具体页面）。使用广告拦截插件时统计脚本可能被拦截，不影响使用工具。</p>
      <p>除此之外，本站没有广告或其他第三方追踪代码。</p>`;

const ANALYTICS_OFF = `
      <p>目前没有使用任何访问统计、广告或第三方追踪代码。以后如果加入，会先更新这页说明。</p>`;

export function mount(el) {
  el.innerHTML = `
    <article class="prose">
      <p class="lead">一句话：<strong>Outlook 令牌只转发给微软、不存储；2FA 密钥和账号格式转换只在你的浏览器里处理，不会发送到服务器。</strong></p>

      <h2>各个工具会处理哪些数据</h2>
      <ul>
        <li><strong>Outlook 取件：</strong>你提交的邮箱、client_id 和 refresh_token，只在这一次请求里由服务器转发给微软（login.microsoftonline.com、graph.microsoft.com、outlook.office365.com）用来读取邮件。处理完就丢弃，不写入数据库，也不写入日志。读到的邮件直接返回给你的浏览器，服务器不保存。</li>
        <li><strong>2FA 验证码：</strong>密钥和验证码都在你的浏览器里用浏览器自带的加密接口计算，不会发送到服务器。</li>
        <li><strong>账号格式转换：</strong>整个转换在你的浏览器里完成，原始数据和结果都不会发送到服务器。</li>
      </ul>

      <h2>保存在你浏览器里的数据</h2>
      <p>主题、各工具的选项（例如读取方式、输出格式）会保存在当前浏览器的本地存储（localStorage）里，方便下次使用。</p>
      <p>只有你勾选「记住账号」或「记住密钥」时，账号或密钥才会保存在当前浏览器里，而且只在这台设备上。取消勾选、点「清空」，或清除浏览器的网站数据，就会删除。本站服务器看不到这些数据。</p>

      <h2>服务器日志</h2>
      <p>为了排查故障和防止滥用，服务器会记录访问时间、IP 地址、访问的路径、状态码和耗时。不记录请求内容（也就是你提交的账号和令牌），也不记录请求头。日志按大小滚动保存，旧日志会自动删除。</p>
      <p>程序本身只记录错误信息，不记录你提交的数据。</p>

      <h2>访问频率限制</h2>
      <p>为了防止接口被滥用，取件接口按 IP 限制请求频率。计数只保存在服务器内存里，服务重启后清空，不做其他用途。</p>

      <h2>统计与第三方</h2>
      ${analyticsEnabled() ? ANALYTICS_ON : ANALYTICS_OFF}

      <h2>商标与免责声明</h2>
      <p>Outlook、Hotmail、Microsoft 是微软公司的商标，Google Authenticator 是 Google 的商标。${SITE.name}与这些公司没有关联。</p>
      <p>本站工具按现状提供，请只用于管理你有权使用的账号。</p>

      <h2>联系方式</h2>
      <p>有问题或建议，可以通过下面任一方式联系我们：</p>
      <ul>
        <li>QQ：3098407410</li>
        <li>Telegram：<a href="https://t.me/moonx_8888" target="_blank" rel="noopener noreferrer">@moonx_8888</a></li>
      </ul>

      <p class="prose-meta">最后更新：${UPDATED}</p>
    </article>`;
}
