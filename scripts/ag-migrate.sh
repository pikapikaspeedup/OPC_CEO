#!/bin/bash
# Migrate existing data/ and .agents/ to ~/.gemini/antigravity/gateway/
# Usage: bash scripts/ag-migrate.sh
set -euo pipefail

TARGET="${AG_GATEWAY_HOME:-$HOME/.gemini/antigravity/gateway}"
echo "Migration target: $TARGET"
echo ""

mkdir -p "$TARGET/assets/templates" "$TARGET/assets/review-policies" "$TARGET/assets/workflows"

# Migrate registries
for f in projects.json agent_runs.json; do
  if [ -f "data/$f" ]; then
    cp -n "data/$f" "$TARGET/$f" 2>/dev/null && echo "✅ $f" || echo "⏭️  $f (already exists)"
  else
    echo "⏭️  $f (not found in data/)"
  fi
done

# local_conversations.json and hidden_workspaces.json may be in ../data/ (legacy statedb path)
for f in local_conversations.json hidden_workspaces.json; do
  if [ -f "$TARGET/$f" ]; then
    echo "⏭️  $f (already exists)"
    continue
  fi
  for src in "data/$f" "../data/$f"; do
    if [ -f "$src" ]; then
      cp "$src" "$TARGET/$f" && echo "✅ $f (from $src)" && break
    fi
  done
done

# Migrate templates
if [ -d ".agents/assets/templates" ]; then
  count=$(ls .agents/assets/templates/*.json 2>/dev/null | wc -l)
  cp -n .agents/assets/templates/*.json "$TARGET/assets/templates/" 2>/dev/null \
    && echo "✅ templates ($count files)" || echo "⏭️  templates (already exist)"
fi

# Migrate review policies
if [ -d ".agents/assets/review-policies" ]; then
  cp -n .agents/assets/review-policies/*.json "$TARGET/assets/review-policies/" 2>/dev/null \
    && echo "✅ review-policies" || echo "⏭️  review-policies (already exist)"
fi

# Migrate workflows
if [ -d ".agents/workflows" ]; then
  cp -n .agents/workflows/*.md "$TARGET/assets/workflows/" 2>/dev/null \
    && echo "✅ workflows" || echo "⏭️  workflows (already exist)"
fi

echo ""
echo "Done. Contents:"
ls -la "$TARGET/" 2>/dev/null
echo ""
echo "Old data/ files kept as backup. Safe to remove after verification."
