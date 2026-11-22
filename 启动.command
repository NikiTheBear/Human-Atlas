#!/bin/bash
# 双击本文件即可启动本地预览（macOS）
# 作用：绕过 Chrome 对 file:// 的 ES module 限制

cd "$(dirname "$0")" || exit 1

PORT=4173
URL="http://localhost:$PORT/"

echo ""
echo "  人性全息图谱 · The Human Atlas"
echo "  ────────────────────────────────"
echo ""

# 端口已被占用说明服务已在跑，直接开浏览器
if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  检测到服务已在运行，直接打开浏览器…"
  open "$URL"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭此窗口"
  exit 0
fi

echo "  正在启动本地服务（$URL）…"
echo "  关闭此窗口即停止服务。"
echo ""

# 后台打开浏览器，前台跑服务
( sleep 1.2 && open "$URL" ) &

exec node serve.js
