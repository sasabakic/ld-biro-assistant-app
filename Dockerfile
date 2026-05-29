# Sandbox image for safely INSTALLING ld-biro-assistant-app's dependencies.
#
# Why: `pnpm install` executes packages' install scripts — the exact vector the
# Shai-Hulud worm abuses. Running them in here keeps them off your Mac, away from
# your SSH keys, npm tokens and cloud credentials. The container is given no
# secrets and no Linux capabilities (see docker-compose.yml).
#
# NOTE: this is install/vet only. You CANNOT run the native Expo/React Native app
# from a Linux container (no iOS simulator / Android emulator) — keep running
# `expo start` and EAS builds on your Mac.
FROM node:24-bookworm-slim

# pnpm comes from corepack and auto-matches this repo's pinned
# "packageManager": "pnpm@11.4.0" field — no global pnpm install needed.
RUN corepack enable

# pnpm's default store on Linux (~/.local/share/pnpm/store) is mounted as a named
# volume by compose, so installs are cached but nothing lands on the host.
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /app
CMD ["bash"]
