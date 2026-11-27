# 部署：在 1Panel 服务器上运行号工具

服务器已经装了 1Panel 时用这套方式（没有 1Panel 时看 [README.md](README.md) 的 Caddy 方式）。

- 号工具跑在 Docker 容器 `haokit` 里，代码在 `/opt/haokit`，配置在 `/etc/haokit.env`。
- 容器用主机网络，只监听本机 `127.0.0.1`，公网访问不到；由 1Panel 的 OpenResty 反向代理并提供 HTTPS。
- 端口写在 `/etc/haokit.env` 的 `PORT` 里，线上用随机高位端口（当前 `10753`）。要换端口：改 `PORT`，运行 `deploy/push.sh` 重建容器，再把 1Panel 网站的代理地址改成新端口。
- 容器以非 root 用户运行、文件系统只读、内存上限 384 MB，日志最多保留 3 个 10 MB 文件。

## 1. 上线或更新代码

在本机项目根目录运行（第二个参数是 SSH 私钥路径）：

```bash
deploy/push.sh root@186.241.81.72 ~/.ssh/id_ed25519_186_241_81_72
```

脚本会上传代码、重建镜像、重启容器，并等健康检查通过。第一次运行时还要在服务器上创建配置文件：

```bash
cp /opt/haokit/.env.example /etc/haokit.env && chmod 600 /etc/haokit.env
```

回滚到上一版（在服务器上）：

```bash
cd /opt && mv haokit haokit.bad && mv haokit.old haokit && cd haokit && docker compose -f deploy/docker-compose.yml up -d --build
```

## 2. 在 1Panel 里建网站

1. 域名解析：在域名后台加一条 A 记录，指向服务器 IP。
2. 1Panel →「网站」→「创建网站」→ 选「反向代理」：主域名填你的域名，代理地址填 `http://127.0.0.1:10753`（即 `/etc/haokit.env` 里的 `PORT`）。
3. 进入这个网站的设置 →「HTTPS」→ 启用，用 1Panel 申请 Let's Encrypt 证书（HTTP 验证即可），打开「HTTP 跳转 HTTPS」。
4. 在服务器上把 `/etc/haokit.env` 里的 `SITE_URL` 改成正式地址（如 `https://haokit.run`），然后重启容器：

```bash
docker restart haokit
```

## 3. 上线后检查

```bash
curl -s https://你的域名/api/health
```

```bash
curl -sI https://你的域名/ | grep -iE "strict-transport|content-security|x-frame"
```

再用浏览器打开每个工具：2FA 验证码要在 HTTPS 下才能显示，取件要能读到邮件，控制台不能有报错。

## 4. 日常维护

- 看日志：`docker logs -f haokit`，或 1Panel →「容器」里的 haokit。
- 改配置：编辑 `/etc/haokit.env` 后 `docker restart haokit`（改的是 `PORT` 时要重建容器：`cd /opt/haokit && docker compose -f deploy/docker-compose.yml up -d --force-recreate`）。参数含义见 `.env.example`。
- 访问统计：按 [README.md](README.md) 的「访问统计」一节拿到令牌，写进 `/etc/haokit.env` 的 `CF_ANALYTICS_TOKEN`，再重启容器。
- 网站访问日志：1Panel 的网站日志会一直变大，在 1Panel →「计划任务」里加一个「切割网站日志」任务（每天一次，保留 30 份）。
- 访问日志由 OpenResty 记录，不包含请求内容；不要在网站配置里加记录请求体的日志格式，取件请求里有用户的 refresh_token。
