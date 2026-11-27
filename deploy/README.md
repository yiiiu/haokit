# 部署：号工具（HaoKit）

> 服务器已经装了 1Panel 时，改看 [1panel.md](1panel.md)（Docker 运行，由 1Panel 的 OpenResty 反向代理）。本页是没有 1Panel 时的 Caddy + systemd 方式。

目标环境：一台海外 VPS（香港 / 新加坡 / 日本，1 核 1–2 GB），Ubuntu 24.04，Node 22，Caddy 做 HTTPS 反向代理，systemd 管理进程。下面的命令都在服务器上执行，`haokit.xyz` 换成你的域名。

## 1. 准备

- 域名：在注册商后台加两条 A 记录：`@` 和 `www` 都指向服务器 IP（有 IPv6 再加 AAAA）。
- 服务器：开放 80 和 443 端口（Caddy 申请证书要用 80），SSH 只用密钥登录。

## 2. 安装 Node 22 和 Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt-get install -y nodejs git caddy
```

Ubuntu 自带源里的 Caddy 版本可能偏旧，需要新版时按 https://caddyserver.com/docs/install 添加官方源。

## 3. 拉代码、装依赖

```bash
sudo useradd --system --home /opt/haokit --shell /usr/sbin/nologin haokit
```

```bash
sudo git clone <你的私有仓库地址> /opt/haokit
```

```bash
cd /opt/haokit && sudo npm ci --omit=dev && sudo chown -R root:haokit /opt/haokit && sudo chmod -R g+rX,o-rwx /opt/haokit
```

代码目录归 root 所有、服务用户只读，程序被攻破也改不了代码。

## 4. 配置

```bash
sudo cp /opt/haokit/.env.example /etc/haokit.env && sudo chmod 640 /etc/haokit.env && sudo chown root:haokit /etc/haokit.env
```

编辑 `/etc/haokit.env`，至少把 `SITE_URL` 改成正式域名。其他参数的含义见文件里的注释。

## 5. 启动服务

```bash
sudo cp /opt/haokit/deploy/haokit.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now haokit
```

```bash
sudo mkdir -p /etc/systemd/journald.conf.d && sudo cp /opt/haokit/deploy/journald-haokit.conf /etc/systemd/journald.conf.d/ && sudo systemctl restart systemd-journald
```

看日志：

```bash
journalctl -u haokit -f
```

## 6. 配置 Caddy

把 `deploy/Caddyfile` 里的 `haokit.xyz` 换成你的域名，然后：

```bash
sudo mkdir -p /var/log/caddy && sudo chown caddy:caddy /var/log/caddy
```

```bash
sudo cp /opt/haokit/deploy/Caddyfile /etc/caddy/Caddyfile && sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy
```

第一次访问时 Caddy 会自动申请证书，之后自动续期。

## 7. 上线后检查

```bash
curl -s https://haokit.xyz/api/health
```

```bash
curl -sI https://haokit.xyz/ | grep -iE "strict-transport|content-security|x-frame"
```

```bash
curl -s https://haokit.xyz/sitemap.xml
```

再用浏览器打开每个工具，确认 2FA 验证码正常显示（必须是 HTTPS）、取件能读到邮件、控制台没有报错。

## 8. 更新与回滚

每次上线前在本地打一个标签（如 `v1.0.1`），服务器上：

```bash
cd /opt/haokit && sudo git fetch --tags && sudo git checkout v1.0.1 && sudo npm ci --omit=dev && sudo systemctl restart haokit
```

出问题时 checkout 上一个标签，再执行同样的 `npm ci` 和重启。

## 9. 可选：Cloudflare

- DNS 记录打开代理（橙色云朵），SSL/TLS 选 Full (strict)。
- `/etc/haokit.env` 设置 `CLIENT_IP_HEADER=cf-connecting-ip`。
- 防火墙只放行 Cloudflare 的 IP 段访问 80 / 443（https://www.cloudflare.com/ips/），防止有人直连服务器伪造 IP 头。
- 注意：Cloudflare 免费版在中国大陆的访问速度时好时坏，主要用户在国内时可以先不套。

## 10. 上线后要做的

- 在线监控：UptimeRobot 免费版新建 HTTP 监控，地址 `https://haokit.xyz/api/health`，间隔 5 分钟，配置邮件或 Telegram 告警。
- 搜索引擎：在百度搜索资源平台和 Google Search Console 验证网站，提交 `https://haokit.xyz/sitemap.xml`。
- 访问统计：按下面「访问统计」一节开通 Cloudflare Web Analytics。

## 访问统计

用 Cloudflare Web Analytics，免费、不用 Cookie，域名不用迁到 Cloudflare。

1. 注册并登录 Cloudflare，进入左侧的 **Web Analytics**，点 **Add a site**，填 `haokit.xyz`，点 **Done**。
2. 在 **Manage site** 里显示的代码中，复制 `"token": "…"` 引号里的那串字母数字。
3. 在 `/etc/haokit.env` 里加一行 `CF_ANALYTICS_TOKEN=刚才那串`，然后重启：

```bash
sudo systemctl restart haokit
```

4. 检查是否生效（有输出就对了），几分钟后 Cloudflare 后台开始出数据：

```bash
curl -s https://haokit.xyz/ | grep -o "cloudflareinsights[^\"]*"
```

开启后服务器会自动放行统计脚本的安全策略（CSP），隐私说明页也会自动换成「使用了 Cloudflare 统计」的说明，不用改代码。

- 能看到：访问量、访客数、每个工具页（`/outlook`、`/2fa`、`/convert`）的访问次数、来源网站、国家、浏览器和设备、页面加载速度；站内切换工具也会统计。数据保留 6 个月。
- 看不到：用了广告拦截插件的访客；具体取件了多少次（取件请求不经过统计脚本）。
- 域名套了 Cloudflare 代理（橙色云朵）时，Web Analytics 可能默认开启「自动注入」。到 **Manage site** 改成 **Enable with JS Snippet installation**，只用我们自己加的这段代码，避免重复统计。

取件次数从 Caddy 访问日志里数（按天统计，包含自动刷新；只算当前日志文件）：

```bash
sudo apt-get install -y jq
```

```bash
sudo jq -r 'select(.request.method=="POST" and .request.uri=="/api/outlook/messages") | .ts | floor | strftime("%Y-%m-%d")' /var/log/caddy/haokit.access.log | sort | uniq -c
```

## 日志里有什么

- Caddy 访问日志（`/var/log/caddy/haokit.access.log`）：时间、IP、方法、路径、状态码、耗时；请求头和响应头已删除，不记录请求内容；每个文件 20 MB，保留 10 个。
- 程序日志（journald）：启动信息和错误信息，不打印请求内容；总量上限 200 MB，最多保留 30 天。
- 不要给 Caddy 加记录请求内容的配置，也不要在代码里打印 `req.body`：取件请求里有用户的 refresh_token。
