// 安全响应头
import { template } from './template.js';

export function securityHeaders() {
  return (req, res, next) => {
    const { scriptHashes } = template();
    const csp = [
      "default-src 'self'",
      // 只允许本站脚本，以及 index.html 里那段内联主题脚本（按哈希放行）
      `script-src 'self' ${scriptHashes.map((h) => `'${h}'`).join(' ')}`,
      // 邮件正文在 srcdoc 沙箱 iframe 里显示，会继承这里的策略：
      // 邮件里的远程图片、样式和字体需要放行（脚本仍然一律禁止）
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data: https:",
      "connect-src 'self'",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // 只在 HTTPS 请求上要求浏览器以后都用 HTTPS（反向代理转发的协议要靠 trust proxy 识别）
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
