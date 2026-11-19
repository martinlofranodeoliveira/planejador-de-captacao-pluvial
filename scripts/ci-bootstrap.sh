#!/usr/bin/env bash
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${CI:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" || "${RUNNER_OS:-}" != "Linux" || "$EUID" -eq 0 ]]; then
  printf '%s\n' 'BOOTSTRAP_REQUIRES_HOSTED_GITHUB_LINUX_VM' >&2
  exit 2
fi
atendimento_node="$(command -v node)"
if [[ "$atendimento_node" != "/opt/hostedtoolcache/node/22.22.1/x64/bin/node" || "$("$atendimento_node" --version)" != "v22.22.1" ]]; then
  printf '%s\n' 'REVIEWED_NODE_RUNTIME_REQUIRED' >&2
  exit 2
fi
sudo -n apt-get update -qq
sudo -n apt-get install --yes --no-install-recommends bubblewrap util-linux
sudo -n install --mode=755 "$atendimento_node" /usr/bin/node
