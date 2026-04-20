#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DISTRO="${DISTRO:-auto}"
INSTALL_DOCTL=1
INSTALL_ACT=1
INSTALL_PLAYWRIGHT=0
INSTALL_ANSIBLE_COLLECTIONS=1
INSTALL_NPM_DEPS=1
ENABLE_DOCKER=1
ADD_DOCKER_GROUP=1

usage() {
  cat <<'EOF'
Usage: scripts/setup-e2e.sh [options]

Options:
  --distro <auto|ubuntu|arch>   Override distro detection.
  --skip-doctl                  Skip doctl installation.
  --skip-act                    Skip act installation.
  --with-playwright             Install Playwright Chromium.
  --skip-ansible-collections    Skip ansible-galaxy collection install.
  --skip-npm-install            Skip npm install.
  --skip-docker-enable          Skip enabling/starting Docker.
  --skip-docker-group           Skip adding the current user to the docker group.
  -h, --help                    Show this help.

Environment:
  DISTRO=ubuntu|arch            Same as --distro.
EOF
}

log() {
  printf '[setup-e2e] %s\n' "$*"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  }
}

run_as_root() {
  if [ "${EUID}" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

detect_distro() {
  if [ "$DISTRO" != "auto" ]; then
    printf '%s\n' "$DISTRO"
    return
  fi

  if [ -r /etc/os-release ]; then
    . /etc/os-release
    case "${ID:-}" in
      ubuntu) printf 'ubuntu\n' ;;
      arch) printf 'arch\n' ;;
      *)
        case "${ID_LIKE:-}" in
          *ubuntu*|*debian*) printf 'ubuntu\n' ;;
          *arch*) printf 'arch\n' ;;
          *)
            printf 'Unsupported distro. Set --distro ubuntu or --distro arch.\n' >&2
            exit 1
            ;;
        esac
        ;;
    esac
  else
    printf 'Unable to detect distro. Set --distro ubuntu or --distro arch.\n' >&2
    exit 1
  fi
}

install_doctl_binary() {
  need_cmd curl
  need_cmd tar
  need_cmd install

  local arch doctl_arch doctl_version tmpdir
  arch="$(uname -m)"
  case "$arch" in
    x86_64) doctl_arch="amd64" ;;
    aarch64) doctl_arch="arm64" ;;
    *)
      printf 'Unsupported architecture for doctl: %s\n' "$arch" >&2
      exit 1
      ;;
  esac

  doctl_version="$(curl -fsSL https://api.github.com/repos/digitalocean/doctl/releases/latest | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p' | head -n 1)"
  if [ -z "$doctl_version" ]; then
    printf 'Unable to resolve the latest doctl version.\n' >&2
    exit 1
  fi

  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN
  curl -fsSLo "$tmpdir/doctl.tar.gz" "https://github.com/digitalocean/doctl/releases/download/v${doctl_version}/doctl-${doctl_version}-linux-${doctl_arch}.tar.gz"
  tar -C "$tmpdir" -xf "$tmpdir/doctl.tar.gz"
  run_as_root install "$tmpdir/doctl" /usr/local/bin/doctl
}

install_ubuntu_packages() {
  log "Installing Ubuntu system dependencies"
  run_as_root apt update
  run_as_root apt install -y \
    git curl ca-certificates gnupg rsync openssh-client python3 python3-pip \
    nodejs npm docker.io docker-compose-v2 software-properties-common

  if ! command -v ansible >/dev/null 2>&1; then
    run_as_root add-apt-repository --yes ppa:ansible/ansible
    run_as_root apt update
    run_as_root apt install -y ansible
  fi
}

install_arch_packages() {
  log "Installing Arch system dependencies"
  run_as_root pacman -Syu --needed \
    git curl ca-certificates rsync openssh python python-pip \
    nodejs npm docker docker-compose ansible
}

install_doctl() {
  if command -v doctl >/dev/null 2>&1; then
    log "doctl already installed"
    return
  fi

  case "$1" in
    ubuntu)
      if command -v snap >/dev/null 2>&1; then
        log "Installing doctl with snap"
        run_as_root snap install doctl
      else
        log "snap is unavailable; installing doctl from the official binary release"
        install_doctl_binary
      fi
      ;;
    arch)
      log "Installing doctl from the official binary release"
      install_doctl_binary
      ;;
  esac
}

install_act() {
  if command -v act >/dev/null 2>&1; then
    log "act already installed"
    return
  fi

  log "Installing act from the upstream install script"
  curl https://raw.githubusercontent.com/nektos/act/master/install.sh | run_as_root bash
}

enable_docker() {
  if [ "$ENABLE_DOCKER" -eq 1 ]; then
    log "Enabling Docker service"
    run_as_root systemctl enable --now docker
  fi

  if [ "$ADD_DOCKER_GROUP" -eq 1 ]; then
    log "Adding ${USER} to the docker group"
    run_as_root usermod -aG docker "$USER"
  fi
}

install_repo_dependencies() {
  if [ "$INSTALL_NPM_DEPS" -eq 1 ]; then
    log "Installing npm dependencies"
    (cd "$ROOT_DIR" && npm install)
  fi

  if [ "$INSTALL_ANSIBLE_COLLECTIONS" -eq 1 ]; then
    need_cmd ansible-galaxy
    log "Installing Ansible collections"
    (cd "$ROOT_DIR" && ansible-galaxy collection install -r deploy/digitalocean/ansible/requirements.yml)
  fi

  if [ "$INSTALL_PLAYWRIGHT" -eq 1 ]; then
    log "Installing Playwright Chromium"
    (cd "$ROOT_DIR" && npx playwright install chromium)
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --distro)
      DISTRO="${2:-}"
      shift 2
      ;;
    --skip-doctl)
      INSTALL_DOCTL=0
      shift
      ;;
    --skip-act)
      INSTALL_ACT=0
      shift
      ;;
    --with-playwright)
      INSTALL_PLAYWRIGHT=1
      shift
      ;;
    --skip-ansible-collections)
      INSTALL_ANSIBLE_COLLECTIONS=0
      shift
      ;;
    --skip-npm-install)
      INSTALL_NPM_DEPS=0
      shift
      ;;
    --skip-docker-enable)
      ENABLE_DOCKER=0
      shift
      ;;
    --skip-docker-group)
      ADD_DOCKER_GROUP=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

need_cmd curl

resolved_distro="$(detect_distro)"
log "Detected distro: ${resolved_distro}"

case "$resolved_distro" in
  ubuntu) install_ubuntu_packages ;;
  arch) install_arch_packages ;;
  *)
    printf 'Unsupported distro: %s\n' "$resolved_distro" >&2
    exit 1
    ;;
esac

enable_docker

if [ "$INSTALL_DOCTL" -eq 1 ]; then
  install_doctl "$resolved_distro"
fi

if [ "$INSTALL_ACT" -eq 1 ]; then
  install_act
fi

install_repo_dependencies

cat <<'EOF'

Setup complete.

Next steps:
  1. Start a new shell so the docker group change takes effect.
  2. Copy .env.example to .env if you have not done that yet.
  3. For hosted deployment, ensure the A record for speclens.tinamk.no points to the target droplet public IPv4.
  4. Run npm run validate:local
  5. Optionally run act -l and the DigitalOcean Ansible playbooks.
EOF
