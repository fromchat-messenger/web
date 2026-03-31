#!/bin/bash
set -e

# Complete deployment script: build and push to server
# Usage: ./scripts/deploy.sh [server_user@server_host] [deployment_path] [platform]
# Example: ./scripts/deploy.sh user@example.com /home/user/fromchat linux/arm64

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Helper functions
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
step() { echo -e "${CYAN}${BOLD}→${NC} ${BOLD}$1${NC}"; }
substep() { 
    if [ "$2" = "-n" ]; then
        echo -n -e "  ${GREEN}•${NC} $1"
    else
        echo -e "  ${GREEN}•${NC} $1"
    fi
}

echo -e "${MAGENTA}${BOLD}🚀 Deployment${NC}\n"


read_password() {
    local password=""
    local char
    local old_stty

    old_stty=$(stty -g 2>/dev/null)
    stty -echo 2>/dev/null

    while IFS= read -rs -n 1 char; do
        if [ -z "$char" ]; then
            break
        fi
        if [ "$char" = $'\177' ] || [ "$char" = $'\b' ]; then
            if [ ${#password} -gt 0 ]; then
                password="${password%?}"
                printf "\b \b" >&2
            fi
        else
            password+="$char"
            printf "*" >&2
        fi
    done

    stty "$old_stty" 2>/dev/null
    echo "" >&2
    echo "$password"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOYMENT_DIR="$PROJECT_ROOT/deployment"
ENV_FILE="$DEPLOYMENT_DIR/.env"

# Load .env file if it exists
if [ -f "$ENV_FILE" ]; then
    # Export variables from .env file (ignore comments and empty lines)
    set -a
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        case "$line" in
            \#*|'') continue ;;
            *)
                # Export the variable
                export "$line" 2>/dev/null || true
                ;;
        esac
    done < "$ENV_FILE"
    set +a
fi

# Read server from environment variable (from .env), command line argument, or fallback
SERVER="${1:-${DEPLOYMENT_SERVER:-}}"
REPO_NAME="FromChat"
DEPLOY_PATH="~/actions-runner/_work/$REPO_NAME/$REPO_NAME"
PLATFORM="linux/arm64"

# Prefer plain `docker build` when target arch matches host arch.
# This avoids Docker Desktop buildx export/load issues and is faster for same-arch builds.
HOST_ARCH_RAW="$(uname -m 2>/dev/null || echo "")"
case "$HOST_ARCH_RAW" in
    arm64|aarch64) HOST_ARCH="arm64" ;;
    x86_64|amd64) HOST_ARCH="amd64" ;;
    *) HOST_ARCH="$HOST_ARCH_RAW" ;;
esac
PLATFORM_ARCH="${PLATFORM##*/}"
USE_DOCKER_BUILD=false
if [ -n "$HOST_ARCH" ] && [ "$HOST_ARCH" = "$PLATFORM_ARCH" ]; then
    USE_DOCKER_BUILD=true
fi

# Check if server is provided
if [ -z "$SERVER" ]; then
    error "Server not specified. Usage: $0 [user@host] [deployment_path] [platform]"
    echo "   Or set DEPLOYMENT_SERVER in $ENV_FILE or as an environment variable"
    echo ""
    echo "Example:"
    echo "  $0 user@example.com /home/user/fromchat linux/arm64"
    echo "  Or add to $ENV_FILE: DEPLOYMENT_SERVER=user@example.com"
    echo "  Or: DEPLOYMENT_SERVER=user@example.com $0"
    exit 1
fi

# ============================================================================
# SSH AUTHENTICATION
# ============================================================================

step "Authentication"
SSH_KEY_FILE="$HOME/.ssh/id_rsa"
SSH_KEY_PUB_FILE="$SSH_KEY_FILE.pub"

# Ensure ssh-agent is running
if [ -z "$SSH_AUTH_SOCK" ]; then
    eval "$(ssh-agent -s)" > /dev/null 2>&1
fi

# Check if SSH key exists
if [ ! -f "$SSH_KEY_FILE" ]; then
    error "SSH key not found at $SSH_KEY_FILE"
    echo "   Please generate an SSH key pair first:"
    echo "   ssh-keygen -t rsa -b 4096 -C 'your_email@example.com'"
    exit 1
fi

# Add SSH key to agent if not already loaded
KEY_LOADED=false
if ssh-add -l > /dev/null 2>&1; then
    # Check if this specific key is loaded by trying to match the public key
    KEY_FINGERPRINT=$(ssh-keygen -lf "$SSH_KEY_FILE" 2>/dev/null | awk '{print $2}')
    if [ -n "$KEY_FINGERPRINT" ] && ssh-add -l 2>/dev/null | grep -q "$KEY_FINGERPRINT"; then
        KEY_LOADED=true
    fi
fi

if [ "$KEY_LOADED" = false ]; then
    substep "Adding SSH key to agent..."
    if ! ssh-add "$SSH_KEY_FILE" 2>/dev/null; then
        error "Failed to add SSH key to agent. Check your key passphrase."
        exit 1
    fi
fi

# Require key-based SSH auth; do not attempt to copy keys automatically.
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$SERVER" "echo 'SSH key works'" >/dev/null 2>&1; then
    error "SSH key authentication failed for $SERVER"
    echo "   Copy your public key to the server, then re-run deploy:"
    echo "   ssh-copy-id -i \"$SSH_KEY_PUB_FILE\" \"$SERVER\""
    echo ""
    echo "   Or manually append this key to ~/.ssh/authorized_keys on the server:"
    echo "   $(cat "$SSH_KEY_PUB_FILE")"
    exit 1
fi

# ============================================================================
# SUDO AUTHENTICATION
# ============================================================================

SUDO_PASSWORD=""
# Prompt for sudo password (optional; leave blank for passwordless sudo)
if [ -z "$SUDO_PASSWORD" ]; then
    while true; do
        substep "Sudo password: " -n
        SUDO_PASSWORD=$(read_password)

        if [ -z "$SUDO_PASSWORD" ]; then
            warning "No password provided - assuming passwordless sudo"
            break
        fi

        if echo "$SUDO_PASSWORD" | ssh "$SERVER" "sudo -S -v" > /dev/null 2>&1; then
            export SUDO_PASSWORD
            break
        else
            echo -n "  " && error "Invalid password, please try again"
        fi
    done
fi

# ============================================================================
# BUILD PHASE
# ============================================================================

echo -e "\n${MAGENTA}${BOLD}🔨 Building Docker images${NC}\n"

# Determine project name
if [ -n "$SERVER" ]; then
    COMPOSE_DIR=$(ssh "$SERVER" "dirname $DEPLOY_PATH/deployment/docker-compose.yml" 2>/dev/null || echo "$DEPLOY_PATH/deployment")
    PROJECT_NAME=$(ssh "$SERVER" "basename $COMPOSE_DIR" 2>/dev/null || echo "deployment")
else
    PROJECT_NAME=$(basename "$DEPLOYMENT_DIR")
fi

# Check if Docker daemon is running
check_docker_daemon() {
    docker info > /dev/null 2>&1
}

# Start Docker Desktop
start_docker_desktop() {
    substep "Starting Docker Desktop..."
    if ! docker desktop start > /dev/null 2>&1; then
        return 1
    fi
    
    # Wait for Docker to be ready (max 60 seconds)
    substep "Waiting for Docker to start..." -n
    local max_wait=60
    local waited=0
    while [ $waited -lt $max_wait ]; do
        if check_docker_daemon; then
            echo ""
            return 0
        fi
        sleep 2
        waited=$((waited + 2))
        echo -n "."
    done
    echo ""
    return 1
}

# Check Docker daemon
if ! check_docker_daemon; then
    warning "Docker daemon is not running"
    if ! start_docker_desktop; then
        error "Failed to start Docker Desktop. Please start it manually and try again."
    fi
fi

if [ "$USE_DOCKER_BUILD" = false ]; then
    # Check buildx
    if ! docker buildx version > /dev/null 2>&1; then
        error "Docker buildx not available. Install Docker Desktop."
    fi

    # Setup buildx builder
    step "Setting up buildx builder"
    BUILDER_NAME="fromchat-builder"
    BUILDER_EXISTS=false

    if docker buildx inspect "$BUILDER_NAME" > /dev/null 2>&1; then
        BUILDER_EXISTS=true
        if ! docker buildx use "$BUILDER_NAME" > /dev/null 2>&1; then
            substep "Recreating builder..."
            docker buildx rm "$BUILDER_NAME" > /dev/null 2>&1 || true
            BUILDER_EXISTS=false
        elif ! docker buildx inspect "$BUILDER_NAME" > /dev/null 2>&1; then
            substep "Recreating builder (inspection failed)..."
            docker buildx rm "$BUILDER_NAME" > /dev/null 2>&1 || true
            BUILDER_EXISTS=false
        fi
    fi

    if [ "$BUILDER_EXISTS" = false ]; then
        substep "Creating builder with persistent cache..."
        docker buildx create \
            --name "$BUILDER_NAME" \
            --driver docker-container \
            --driver-opt image=moby/buildkit:latest \
            --use \
            --bootstrap > /dev/null 2>&1
    fi

    docker buildx use "$BUILDER_NAME" > /dev/null 2>&1
fi

# Detect services
step "Detecting services"
cd "$DEPLOYMENT_DIR"
# Include profile-only services (e.g. caddy) so their images are built and pushed; otherwise prod keeps a stale Caddy image and ignores Caddyfile updates from rsync.
export COMPOSE_PROFILES=production
SERVICES=$(docker compose -f docker-compose.yml config --services 2>/dev/null)

if [ -z "$SERVICES" ]; then
    error "No services found in docker-compose.yml"
fi

if ! command -v jq >/dev/null 2>&1; then
    error "jq is required for deploy (e.g. brew install jq / sudo apt install jq)"
    exit 1
fi

if ! COMPOSE_JSON=$(docker compose -f docker-compose.yml config --format json 2>/dev/null); then
    error "docker compose config --format json failed (needs Docker Compose v2.10+)"
    exit 1
fi

BUILT_IMAGES=()

for SERVICE in $SERVICES; do
    if ! jq -e --arg s "$SERVICE" '(.services[$s].build // false) | type == "object"' <<< "$COMPOSE_JSON" >/dev/null 2>&1; then
        continue
    fi

    IMAGE_TAG="${PROJECT_NAME}-${SERVICE}:latest"

    substep "Building ${CYAN}$SERVICE${NC} -> ${CYAN}$IMAGE_TAG${NC}..."

    DOCKERFILE_REL=$(jq -r --arg s "$SERVICE" '.services[$s].build.dockerfile // empty' <<< "$COMPOSE_JSON")
    CONTEXT_REL=$(jq -r --arg s "$SERVICE" '.services[$s].build.context // empty' <<< "$COMPOSE_JSON")
    # Multi-stage deployment/Dockerfile: without --target, the final stage (file_storage) is always tagged.
    BUILD_TARGET=$(jq -r --arg s "$SERVICE" '.services[$s].build.target // empty' <<< "$COMPOSE_JSON")
    
    if [ -z "$CONTEXT_REL" ]; then
        CONTEXT_REL=".."
    fi
    
    if [[ "$CONTEXT_REL" == ".." ]]; then
        BUILD_CONTEXT="$PROJECT_ROOT"
    elif [[ "$CONTEXT_REL" == /* ]]; then
        BUILD_CONTEXT="$CONTEXT_REL"
    else
        BUILD_CONTEXT="$DEPLOYMENT_DIR/$CONTEXT_REL"
    fi
    
    if [ -n "$DOCKERFILE_REL" ]; then
        if [[ "$DOCKERFILE_REL" == /* ]]; then
            DOCKERFILE="$DOCKERFILE_REL"
        else
            if [[ "$CONTEXT_REL" == ".." ]] || [[ "$BUILD_CONTEXT" == "$PROJECT_ROOT" ]]; then
                DOCKERFILE="$PROJECT_ROOT/$DOCKERFILE_REL"
            else
                DOCKERFILE="$BUILD_CONTEXT/$DOCKERFILE_REL"
            fi
        fi
    else
        if [ -f "$DEPLOYMENT_DIR/Dockerfile.$SERVICE" ]; then
            DOCKERFILE="$DEPLOYMENT_DIR/Dockerfile.$SERVICE"
        elif [ -f "$DEPLOYMENT_DIR/$SERVICE/Dockerfile" ]; then
            DOCKERFILE="$DEPLOYMENT_DIR/$SERVICE/Dockerfile"
        else
            error "Could not determine Dockerfile for $SERVICE"
        fi
    fi
    
    if [ "$USE_DOCKER_BUILD" = true ]; then
        DOCKER_BUILD_ARGS=(build --platform "$PLATFORM" --file "$DOCKERFILE" --tag "$IMAGE_TAG")
        if [ -n "$BUILD_TARGET" ]; then
            DOCKER_BUILD_ARGS+=(--target "$BUILD_TARGET")
        fi
        DOCKER_BUILD_ARGS+=("$BUILD_CONTEXT")

        if docker "${DOCKER_BUILD_ARGS[@]}"; then
            echo -e "  ${GREEN}✓${NC} Built ${CYAN}$SERVICE${NC}"
            BUILT_IMAGES+=("$IMAGE_TAG")
            echo ""
        else
            error "Build failed for $SERVICE"
            exit 1
        fi
    else
        # On macOS Docker Desktop, --load can hang for a long time at "sending tarball".
        # Use the docker exporter explicitly to load into the local Docker daemon.
        BUILDX_ARGS=(buildx build --platform "$PLATFORM" --file "$DOCKERFILE" --tag "$IMAGE_TAG" --output=type=docker)
        if [ -n "$BUILD_TARGET" ]; then
            BUILDX_ARGS+=(--target "$BUILD_TARGET")
        fi
        BUILDX_ARGS+=("$BUILD_CONTEXT")

        if docker "${BUILDX_ARGS[@]}"; then
            echo -e "  ${GREEN}✓${NC} Built ${CYAN}$SERVICE${NC}"
            BUILT_IMAGES+=("$IMAGE_TAG")
            echo ""
        else
            error "Build failed for $SERVICE"
            exit 1
        fi
    fi

    true

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = true ]; then
        true
    fi

    if [ "$USE_DOCKER_BUILD" = false ]; then
        true
    fi

    true
done

success "Build complete! ${#BUILT_IMAGES[@]} image(s) ready"

# ============================================================================
# DEPLOY PHASE
# ============================================================================

echo -e "\n${MAGENTA}${BOLD}🚀 Deploying to ${SERVER}${NC}\n"


# Check docker pussh
if ! docker pussh --help > /dev/null 2>&1; then
    error "docker pussh plugin not installed"
    echo "   Install: npm run install:pussh"
fi

# Detect images based on docker-compose.yml (prefer explicit `image:` entries; fall back to built tags)
cd "$DEPLOYMENT_DIR"
COMPOSE_SERVICES=$(docker compose -f docker-compose.yml config --services 2>/dev/null || true)
PUSH_IMAGES=()
EXTERNAL_IMAGES=()

for S in $COMPOSE_SERVICES; do
    IMAGE_FROM_COMPOSE=$(jq -r --arg s "$S" '.services[$s].image // empty' <<< "$COMPOSE_JSON")
    HAS_BUILD=$(jq -r --arg s "$S" '(.services[$s].build // empty) | (if . == "" then "" else "yes" end)' <<< "$COMPOSE_JSON")

    if [ -n "$IMAGE_FROM_COMPOSE" ]; then
        # If it has an explicit image and no build section, it likely won't exist locally (and doesn't need pussh).
        if [ -z "$HAS_BUILD" ]; then
            EXTERNAL_IMAGES+=("$IMAGE_FROM_COMPOSE")
        else
            # If a service has both build+image, treat it as a built image (pussh).
            PUSH_IMAGES+=("$IMAGE_FROM_COMPOSE")
        fi
    else
        # If service has a build section (we built it above), use the tag pattern used during build
        TAG="${PROJECT_NAME}-${S}:latest"
        # Only include the tag if the image exists locally (avoid pushing unrelated images)
        if docker images --format "{{.Repository}}:{{.Tag}}" | grep -q "^${TAG}$"; then
            PUSH_IMAGES+=("$TAG")
        fi
    fi
done

# Deduplicate while preserving order
if [ ${#PUSH_IMAGES[@]} -gt 0 ]; then
    PUSH_IMAGES=($(printf "%s\n" "${PUSH_IMAGES[@]}" | awk '!seen[$0]++'))
fi
if [ ${#EXTERNAL_IMAGES[@]} -gt 0 ]; then
    EXTERNAL_IMAGES=($(printf "%s\n" "${EXTERNAL_IMAGES[@]}" | awk '!seen[$0]++'))
fi

# Verify that all built images are among the detected images to be pushed.
# This prevents accidentally pushing unrelated images.
BUILT_COUNT=${#BUILT_IMAGES[@]}
MATCHING_BUILT=0
MISSING_FROM_DETECTED=()
for BI in "${BUILT_IMAGES[@]}"; do
    found=false
    for DI in "${PUSH_IMAGES[@]}"; do
        if [ "$BI" = "$DI" ]; then
            found=true
            break
        fi
    done
    if [ "$found" = true ]; then
        MATCHING_BUILT=$((MATCHING_BUILT + 1))
    else
        MISSING_FROM_DETECTED+=("$BI")
    fi
done

# Also list push images that weren't built locally (these are likely prebuilt local images)
NOT_BUILT_DETECTED=()
for DI in "${PUSH_IMAGES[@]}"; do
    built=false
    for BI in "${BUILT_IMAGES[@]}"; do
        if [ "$DI" = "$BI" ]; then
            built=true
            break
        fi
    done
    if [ "$built" = false ]; then
        NOT_BUILT_DETECTED+=("$DI")
    fi
done

if [ "$BUILT_COUNT" -ne "$MATCHING_BUILT" ]; then
    error "Mismatch between built images (${BUILT_COUNT}) and detected built images (${MATCHING_BUILT})."
    if [ ${#MISSING_FROM_DETECTED[@]} -gt 0 ]; then
        echo "  Built but not detected: ${MISSING_FROM_DETECTED[*]}"
    fi
    if [ ${#NOT_BUILT_DETECTED[@]} -gt 0 ]; then
        echo "  Detected but not built (external images): ${NOT_BUILT_DETECTED[*]}"
    fi
    echo "Aborting to avoid pushing incorrect images."
    exit 1
fi

if [ ${#PUSH_IMAGES[@]} -eq 0 ] && [ ${#EXTERNAL_IMAGES[@]} -eq 0 ]; then
    error "No images found in docker-compose.yml or built locally for project ${PROJECT_NAME}"
fi

# Pre-pull unregistry image if needed
UNREGISTRY_IMAGE="ghcr.io/psviderski/unregistry"
if ! ssh "$SERVER" "sudo docker images --format '{{.Repository}}:{{.Tag}}' | grep -q '^${UNREGISTRY_IMAGE}$'" 2>/dev/null; then
    substep "Pulling unregistry image (one-time setup)..."
    ssh -tt "$SERVER" "sudo docker pull ${UNREGISTRY_IMAGE}"
fi

# Transfer images
step "Transferring images"
for IMAGE in "${PUSH_IMAGES[@]}"; do
    substep "Pushing ${CYAN}$IMAGE${NC}..."
    if docker pussh "$IMAGE" "$SERVER"; then
        echo ""
    else
        echo -e "  ${RED}✗${NC} Failed to push ${CYAN}$IMAGE${NC}"
        echo ""
        exit 1
    fi
done

# Pull external images directly on the server (no pussh)
if [ ${#EXTERNAL_IMAGES[@]} -gt 0 ]; then
    step "Pulling external images on server"
    for IMAGE in "${EXTERNAL_IMAGES[@]}"; do
        substep "Pulling ${CYAN}$IMAGE${NC}..."
        # Allocate a TTY and do not redirect output so failures are visible.
        if ssh -tt "$SERVER" "sudo docker pull $(printf '%q' "$IMAGE")"; then
            echo ""
        else
            echo -e "  ${RED}✗${NC} Failed to pull ${CYAN}$IMAGE${NC} on server"
            echo ""
            exit 1
        fi
    done
fi

# Transfer files
step "Transferring deployment files"

# Ensure destination directory exists with proper permissions
if [ -n "$SUDO_PASSWORD" ]; then
    ssh "$SERVER" bash << REMOTE_SUDO_SCRIPT > /dev/null 2>&1
set -e
echo '$SUDO_PASSWORD' | sudo -S -p '' mkdir -p $DEPLOY_PATH/deployment $DEPLOY_PATH/backend 2>/dev/null || true
echo '$SUDO_PASSWORD' | sudo -S -p '' chown -R \$(whoami):\$(whoami) $DEPLOY_PATH/deployment $DEPLOY_PATH/backend 2>/dev/null || true
REMOTE_SUDO_SCRIPT
else
    ssh "$SERVER" "sudo mkdir -p $DEPLOY_PATH/deployment $DEPLOY_PATH/backend && sudo chown -R \$(whoami):\$(whoami) $DEPLOY_PATH/deployment $DEPLOY_PATH/backend" > /dev/null 2>&1 || true
fi

# Copy deployment directory excluding gitignored files
cd "$PROJECT_ROOT"
substep "Copying deployment directory..."

# Generate exclude file for rsync using git ls-files to list ignored files
EXCLUDE_FILE="/tmp/fromchat-rsync-exclude-$$"
RSYNC_ERROR="/tmp/fromchat-rsync-error-$$"

# Get ignored files in deployment directory and convert to rsync exclude patterns
git ls-files --others --ignored --exclude-standard deployment/ 2>/dev/null | \
    sed 's|^deployment/||' > "$EXCLUDE_FILE" || true

# Use rsync with native --exclude-from option
if rsync -avz --delete --exclude-from="$EXCLUDE_FILE" \
    "$DEPLOYMENT_DIR/" \
    "$SERVER:$DEPLOY_PATH/deployment/" > "$RSYNC_ERROR" 2>&1; then
    rm -f "$EXCLUDE_FILE" "$RSYNC_ERROR"
else
    echo -e "  ${RED}✗${NC} Rsync failed. Error output:"
    cat "$RSYNC_ERROR" | sed 's/^/    /'
    rm -f "$EXCLUDE_FILE" "$RSYNC_ERROR"
    echo -n "  " && error "Failed to copy deployment directory"
fi

# Copy .env.prod to .env on server (bypassing gitignore)
if [ -f "$DEPLOYMENT_DIR/.env.prod" ]; then
    substep "Copying .env.prod to .env..."
    if ! scp "$DEPLOYMENT_DIR/.env.prod" "$SERVER:$DEPLOY_PATH/deployment/.env" > /dev/null 2>&1; then
        warning "Failed to copy .env.prod to .env"
    fi
else
    warning ".env.prod not found in deployment directory"
fi

# Firebase service account: bind-mounted at runtime (see docker-compose main volumes), never in the image (.dockerignore).
# If compose ever ran without this file on the host, Docker may have created a directory at this path — remove it before scp.
FIREBASE_CERT="$PROJECT_ROOT/backend/firebase-cert.json"
substep "Firebase service account (runtime bind-mount: backend/firebase-cert.json)..."
# ~ is not expanded inside variables on the remote shell (e.g. C="$D/..." with D=~/foo checks a bogus path). Resolve to an absolute path.
DEPLOY_PATH_ON_SERVER=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$SERVER" "eval echo $DEPLOY_PATH" 2>/dev/null || true)
if [ -z "$DEPLOY_PATH_ON_SERVER" ]; then
    DEPLOY_PATH_ON_SERVER=$DEPLOY_PATH
fi
FIREBASE_REMOTE="$DEPLOY_PATH_ON_SERVER/backend/firebase-cert.json"
# Docker may have created this path as a root-owned directory; plain rm fails without sudo.
if [ -n "$SUDO_PASSWORD" ]; then
    ssh "$SERVER" bash << REMOTE_FIREBASE_CLEANUP > /dev/null 2>&1 || true
set -e
D=$DEPLOY_PATH_ON_SERVER
C="\$D/backend/firebase-cert.json"
mkdir -p "\$D/backend" 2>/dev/null || true
if [ -d "\$C" ]; then
    echo '$SUDO_PASSWORD' | sudo -S -p '' rm -rf "\$C"
fi
echo '$SUDO_PASSWORD' | sudo -S -p '' chown -R "\$(whoami):\$(whoami)" "\$D/backend" 2>/dev/null || true
REMOTE_FIREBASE_CLEANUP
else
    QBASE=$(printf '%q' "$DEPLOY_PATH_ON_SERVER")
    ssh "$SERVER" "D=$QBASE; C=\"\$D/backend/firebase-cert.json\"; mkdir -p \"\$D/backend\"; if [ -d \"\$C\" ]; then sudo rm -rf \"\$C\" 2>/dev/null || rm -rf \"\$C\"; fi; sudo chown -R \$(whoami):\$(whoami) \"\$D/backend\" 2>/dev/null || true" > /dev/null 2>&1 || true
fi

while true; do
    if [ -f "$FIREBASE_CERT" ]; then
        break
    fi
    if [ -d "$FIREBASE_CERT" ]; then
        echo -e "  ${YELLOW}⚠${NC} $FIREBASE_CERT is a directory. Delete it and save the Firebase service account JSON as a file at that exact path."
    elif [ -e "$FIREBASE_CERT" ]; then
        echo -e "  ${YELLOW}⚠${NC} $FIREBASE_CERT exists but is not a regular file."
    else
        echo -e "  ${YELLOW}⚠${NC} Missing $FIREBASE_CERT (Firebase service account JSON for FCM)."
    fi
    echo -e "  ${CYAN}Fix this, then press Enter to check again (Ctrl+C to abort deploy).${NC}"
    read -r _
done

substep "Copying backend/firebase-cert.json..."
FIREBASE_SCP_LOG="/tmp/fromchat-firebase-scp-$$.log"
if ! scp "$FIREBASE_CERT" "$SERVER:$FIREBASE_REMOTE" >"$FIREBASE_SCP_LOG" 2>&1; then
    error "Failed to copy firebase-cert.json to server"
    echo -e "  ${YELLOW}Target:${NC} $SERVER:$FIREBASE_REMOTE" >&2
    if [ -s "$FIREBASE_SCP_LOG" ]; then
        sed 's/^/  /' "$FIREBASE_SCP_LOG" >&2
    else
        echo -e "  ${YELLOW}(scp produced no output.)${NC}" >&2
    fi
    rm -f "$FIREBASE_SCP_LOG"
    exit 1
fi
rm -f "$FIREBASE_SCP_LOG"
ssh "$SERVER" "chmod 600 $(printf '%q' "$FIREBASE_REMOTE") 2>/dev/null || true"
if ! ssh "$SERVER" "test -f $(printf '%q' "$FIREBASE_REMOTE")"; then
    error "Server path is not a regular file after copy: $FIREBASE_REMOTE"
    exit 1
fi

# Deploy on server
step "Deploying on server"
ssh "$SERVER" SUDO_PASSWORD="$SUDO_PASSWORD" DEPLOY_PATH="${DEPLOY_PATH_ON_SERVER:-$DEPLOY_PATH}" bash << 'REMOTE_SCRIPT'
set -e

REMOTE_SUDO_PASS="${SUDO_PASSWORD:-}"
REMOTE_DEPLOY_PATH="${DEPLOY_PATH:-}"
export SUDO_PROMPT=""

sudo_cmd() {
    if [ -n "$REMOTE_SUDO_PASS" ]; then
        echo "$REMOTE_SUDO_PASS" | sudo -S -p '' "$@" 2>/dev/null
    else
        sudo "$@" 2>/dev/null
    fi
}

if [ -z "$REMOTE_DEPLOY_PATH" ]; then
    echo "❌ DEPLOY_PATH is not set"
    exit 1
fi

mkdir -p "$REMOTE_DEPLOY_PATH/deployment" "$REMOTE_DEPLOY_PATH/backend"
cd "$REMOTE_DEPLOY_PATH/deployment"

if [ ! -f "$REMOTE_DEPLOY_PATH/deployment/.env" ]; then
    echo "⚠️  Warning: .env file not found"
fi

if systemctl is-active --quiet fromchat; then
    sudo_cmd systemctl stop fromchat
fi

COMPOSE_PROFILES=production docker compose down --remove-orphans > /dev/null 2>&1 || true

sudo_cmd cp -f "$REMOTE_DEPLOY_PATH/deployment/fromchat.service" /etc/systemd/system/fromchat.service
sudo_cmd systemctl daemon-reload
sudo_cmd systemctl restart fromchat

sleep 3
if ! systemctl is-active --quiet fromchat; then
    echo "❌ Service failed to start"
    sudo_cmd journalctl --no-pager -xeu fromchat -n 30
    exit 1
fi
REMOTE_SCRIPT

echo
success "Deployment complete!"
