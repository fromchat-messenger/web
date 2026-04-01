#
# Custom Caddy built with:
# - Rate limit plugin
#

FROM caddy:2-builder AS builder
RUN xcaddy build \
      --with github.com/mholt/caddy-ratelimit

FROM caddy:2

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY additions /etc/caddy/additions

# Merge base Caddyfile + additional snippets (if present),
# in alphabetical order, and remove additions from final image.
RUN sh -c 'set -eu; \
  if [ -d /etc/caddy/additions ]; then \
    tmp="$(mktemp)"; \
    cat /etc/caddy/Caddyfile > "$tmp"; \
    for f in $(printf "%s\n" /etc/caddy/additions/* 2>/dev/null | sort); do \
      [ -f "$f" ] || continue; \
      base="$(basename "$f")"; \
      [ "$base" = ".gitkeep" ] && continue; \
      [ "$base" = ".gitignore" ] && continue; \
      printf "\n\n" >> "$tmp"; \
      cat "$f" >> "$tmp"; \
    done; \
    mv "$tmp" /etc/caddy/Caddyfile; \
    rm -rf /etc/caddy/additions; \
  fi'