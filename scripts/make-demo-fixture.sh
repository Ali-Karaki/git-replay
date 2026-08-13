#!/bin/sh
# Builds a demo repository exercising every quality case (spec 46):
# linear history, branch + merge, renames, binary files, a symlink entry, a
# gitlink, tags, empty commits, a large diff. Point Git Replay at
# fixtures/demo-repo to try the app.
#
# Usage: sh scripts/make-demo-fixture.sh

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/fixtures/demo-repo"

rm -rf "$DEST"
mkdir -p "$DEST"
cd "$DEST"

export GIT_AUTHOR_NAME="Demo Author"
export GIT_AUTHOR_EMAIL="demo@git-replay.local"
export GIT_COMMITTER_NAME="Demo Author"
export GIT_COMMITTER_EMAIL="demo@git-replay.local"

git init -q -b main

# 1. Initial commit: README + core module.
mkdir -p src
cat > README.md <<'EOF'
# Demo Project

A tiny service that processes queue jobs. Replay this repository to watch it
get built, commit by commit.
EOF
cat > src/index.ts <<'EOF'
export const APP_NAME = "demo";
EOF
git add -A && git commit -qm "initial commit: project skeleton"

# 2. Schema + model.
mkdir -p src/models
cat > src/models/deployment.ts <<'EOF'
export interface Deployment {
  id: string;
  status: "pending" | "running" | "done" | "failed";
  createdAt: number;
}
EOF
git add -A && git commit -qm "add deployment model"

# 3. Service layer.
cat > src/deployment-service.ts <<'EOF'
import type { Deployment } from "./models/deployment";

const store = new Map<string, Deployment>();

export function createDeployment(): Deployment {
  const d: Deployment = { id: crypto.randomUUID(), status: "pending", createdAt: Date.now() };
  store.set(d.id, d);
  return d;
}

export function getDeployment(id: string): Deployment | undefined {
  return store.get(id);
}
EOF
git add -A && git commit -qm "add deployment service"

# 4. Tag the first milestone, then branch off for the worker work.
git tag v0.1.0
git checkout -qb feature/worker

# 5. Rename for clarity + extend.
mkdir -p src/deployment
git mv src/deployment-service.ts src/deployment/service.ts
cat >> src/deployment/service.ts <<'EOF'

export function listDeployments(): Deployment[] {
  return [...store.values()];
}
EOF
git add -A && git commit -qm "move service into deployment/ and add listing"

# 6. Binary asset + gitlink + symlink entry in one commit.
mkdir -p assets
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x10\x00\x00\x00\x10' > assets/logo.bin
printf 'demo assets' > assets/readme.txt
git add -A && git commit -qm "add assets (binary + text)"

# 6b. Symlink entry (mode 120000) + gitlink (mode 160000, submodule without a
# real clone) — staged via update-index and committed directly, since
# `git add -A` would stage their deletion.
printf 'target.txt' > .git/symlink-target-tmp
BLOB=$(git hash-object -w .git/symlink-target-tmp)
git update-index --add --cacheinfo "120000,$BLOB,link.txt"
git update-index --add --cacheinfo "160000,0123456789012345678901234567890123456789,vendor/lib"
git commit -qm "add symlink and submodule entries"

# 7. Queue abstraction.
cat > src/queue.ts <<'EOF'
type Job = { id: string; payload: unknown };

export class Queue {
  private jobs: Job[] = [];

  push(job: Job): void {
    this.jobs.push(job);
  }

  pop(): Job | undefined {
    return this.jobs.shift();
  }

  get length(): number {
    return this.jobs.length;
  }
}
EOF
git add -A && git commit -qm "add queue abstraction"

# 8. Wire the worker to the queue.
cat > src/worker.ts <<'EOF'
import { Queue } from "./queue";
import { createDeployment, getDeployment } from "./deployment/service";

export function runWorker(q: Queue): void {
  while (q.length > 0) {
    const job = q.pop();
    if (!job) break;
    const d = createDeployment();
    getDeployment(d.id);
  }
}
EOF
git add -A && git commit -qm "wire worker to consume queue jobs"

# 9. An empty commit (quality case: nothing to show).
git commit -q --allow-empty -m "wip: checkpoint"

# 10. Retry logic.
cat >> src/worker.ts <<'EOF'

export function withRetry(fn: () => void, attempts = 3): void {
  for (let i = 0; i < attempts; i++) {
    try {
      fn();
      return;
    } catch (e) {
      if (i === attempts - 1) throw e;
    }
  }
}
EOF
git add -A && git commit -qm "add retry logic to the worker"

# 11. Back on main: independent work.
git checkout -q main
mkdir -p docs
cat > docs/runbook.md <<'EOF'
# Runbook

1. Start the queue.
2. Start the worker.
3. Watch deployments complete.
EOF
git add -A && git commit -qm "add runbook"

# 12. Merge the worker branch (non-fast-forward → merge commit).
git merge -q --no-ff feature/worker -m "merge feature/worker"

# 13. A large generated file (quality case: huge diff, generated detection).
mkdir -p src/generated
awk 'BEGIN { for (i = 0; i < 1200; i++) printf "export const line_%d = %d;\n", i, i }' > src/generated/constants.ts
git add -A && git commit -qm "generate constants module"

# 14. Cleanup: delete the docs dir and fix the README title.
rm -rf docs
sed -i 's/# Demo Project/# Demo Queue Service/' README.md
git add -A && git commit -qm "cleanup: drop docs, retitle README"

git tag v1.0.0

echo ""
echo "Demo fixture ready at $DEST"
echo "Suggested replay: main (base) → main (head) for the whole story,"
echo "or main → feature/worker (merge-base aware) for the worker branch."
