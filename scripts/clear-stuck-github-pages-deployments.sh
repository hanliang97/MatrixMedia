#!/usr/bin/env bash
# 清理 github-pages 环境中卡住的 in_progress / queued deployment，解除 deploy 超时
#
# 用法：
#   export GITHUB_TOKEN=ghp_xxx   # 需 repo 或 admin:repo 权限
#   ./scripts/clear-stuck-github-pages-deployments.sh
#   ./scripts/clear-stuck-github-pages-deployments.sh hanliang97/MatrixMedia

set -euo pipefail

REPO="${1:-hanliang97/MatrixMedia}"
TOKEN="${GITHUB_TOKEN:?请先设置 GITHUB_TOKEN（Personal Access Token）}"

api() {
  curl -fsSL \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

echo "检查 ${REPO} 的 github-pages deployment…"

page=1
cleared=0

while true; do
  deployments="$(api "https://api.github.com/repos/${REPO}/deployments?environment=github-pages&per_page=100&page=${page}")"

  count="$(echo "${deployments}" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))")"
  if [[ "${count}" -eq 0 ]]; then
    break
  fi

  while IFS= read -r deployment_id; do
    [[ -z "${deployment_id}" ]] && continue

    latest_state="$(api "https://api.github.com/repos/${REPO}/deployments/${deployment_id}/statuses?per_page=1" \
      | python3 -c "import sys,json; s=json.load(sys.stdin); print(s[0]['state'] if s else 'unknown')")"

    if [[ "${latest_state}" == "in_progress" || "${latest_state}" == "queued" || "${latest_state}" == "pending" ]]; then
      echo "  标记 deployment #${deployment_id} (${latest_state}) 为 inactive"
      api -X POST "https://api.github.com/repos/${REPO}/deployments/${deployment_id}/statuses" \
        -d "{\"state\":\"inactive\",\"description\":\"cleared by clear-stuck-github-pages-deployments.sh\",\"environment\":\"github-pages\"}" \
        >/dev/null
      cleared=$((cleared + 1))
    fi
  done < <(echo "${deployments}" | python3 -c "import sys,json; [print(d['id']) for d in json.load(sys.stdin)]")

  if [[ "${count}" -lt 100 ]]; then
    break
  fi
  page=$((page + 1))
done

if [[ "${cleared}" -eq 0 ]]; then
  echo "未发现卡住的 deployment。"
else
  echo "已清理 ${cleared} 个卡住的 deployment。"
fi

echo ""
echo "接下来请在 GitHub 仓库 Settings → Pages："
echo "  Build and deployment → Source 选择「GitHub Actions」（不要再用 gh-pages 分支）"
echo "然后在 Actions 里手动运行 Deploy Website，或 push website/ 变更。"
