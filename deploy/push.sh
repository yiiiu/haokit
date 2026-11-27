#!/usr/bin/env bash
# 把本地代码推到 1Panel 服务器并重建容器（在本机项目根目录运行）
#   deploy/push.sh root@服务器IP [SSH 私钥路径]
# 上传的是 git 跟踪的文件和未被 .gitignore 忽略的新文件；服务器上旧版本保留在 /opt/haokit.old，可用于回滚
set -euo pipefail

TARGET="${1:?用法：deploy/push.sh root@服务器IP [SSH 私钥路径]}"
KEY="${2:-}"
SSH=(ssh -o BatchMode=yes)
[[ -n "$KEY" ]] && SSH+=(-i "$KEY" -o IdentitiesOnly=yes)

cd "$(dirname "$0")/.."

echo "→ 上传代码到 $TARGET:/opt/haokit"
git ls-files -co --exclude-standard -z \
  | COPYFILE_DISABLE=1 tar --null -T - --no-xattrs -czf - \
  | "${SSH[@]}" "$TARGET" '
      set -e
      rm -rf /opt/haokit.new && mkdir -p /opt/haokit.new
      tar -xzf - -C /opt/haokit.new
      if [ -d /opt/haokit ]; then rm -rf /opt/haokit.old && mv /opt/haokit /opt/haokit.old; fi
      mv /opt/haokit.new /opt/haokit'

echo "→ 构建并重启容器"
"${SSH[@]}" "$TARGET" '
  set -e
  cd /opt/haokit
  docker compose -f deploy/docker-compose.yml up -d --build --quiet-pull 2>&1 | tail -3
  port=$(sed -n "s/^PORT=//p" /etc/haokit.env | tail -1)
  for i in $(seq 1 30); do
    sleep 2
    if [ "$(docker inspect -f "{{.State.Health.Status}}" haokit)" = healthy ]; then
      echo "✓ 已上线，健康检查通过（监听 127.0.0.1:${port:-3000}）"; exit 0
    fi
  done
  echo "✗ 健康检查失败，最近日志：" >&2
  docker logs --tail 20 haokit >&2
  exit 1'
