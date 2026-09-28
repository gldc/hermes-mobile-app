#!/usr/bin/env bash
# Vendor hermes-agent's shared TS gateway client + generated contract.
#   scripts/sync-gateway-contract.sh <tag>            re-vendor at <tag>
#   scripts/sync-gateway-contract.sh --verify         re-check upstream hashes against VENDORED.json's tag
# Source: a local hermes-agent clone (HERMES_AGENT_REPO, default ~/Developer/hermes-agent).
# The ONLY edit applied: strip `.js` from relative import/export specifiers (Metro + tsc resolution).
set -euo pipefail

REPO="${HERMES_AGENT_REPO:-$HOME/Developer/hermes-agent}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/src/vendor/hermes-gateway"
FILES=(json-rpc-channel.ts json-rpc-gateway.ts gateway-events.ts gateway-contract.generated.ts)

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
rewrite() { sed -E "s#(from '\./[^']+)\.js'#\1'#g"; }

if [[ "${1:-}" == "--verify" ]]; then
  TAG="$(node -p "require('$DEST/VENDORED.json').tag")"
  git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git -C "$REPO" fetch --tags --quiet
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  fail=0
  for f in "${FILES[@]}" LICENSE; do
    src="apps/shared/src/$f"; [[ "$f" == LICENSE ]] && src="LICENSE"
    git -C "$REPO" show "${TAG}:${src}" > "$TMP/$f"
    want="$(node -p "require('$DEST/VENDORED.json').files['$f'].upstream_sha256")"
    got="$(sha "$TMP/$f")"
    if [[ "$want" != "$got" ]]; then echo "DRIFT upstream $f: $got != $want" >&2; fail=1; fi
  done
  [[ $fail -eq 0 ]] && echo "upstream hashes match $TAG"
  exit $fail
fi

TAG="${1:?usage: sync-gateway-contract.sh <tag> | --verify}"
git -C "$REPO" rev-parse -q --verify "refs/tags/$TAG" >/dev/null || git -C "$REPO" fetch --tags --quiet
COMMIT="$(git -C "$REPO" rev-parse "${TAG}^{commit}")"
mkdir -p "$DEST"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
entries=""
for f in "${FILES[@]}" LICENSE; do
  src="apps/shared/src/$f"; [[ "$f" == LICENSE ]] && src="LICENSE"
  git -C "$REPO" show "${TAG}:${src}" > "$TMP/$f"
  if [[ "$f" == *.ts ]]; then rewrite < "$TMP/$f" > "$DEST/$f"; else cp "$TMP/$f" "$DEST/$f"; fi
  entries+="\"$f\":{\"upstream_sha256\":\"$(sha "$TMP/$f")\",\"vendored_sha256\":\"$(sha "$DEST/$f")\"},"
done
node -e '
  const [tag, commit, files] = process.argv.slice(1);
  const out = { tag, commit, source: "NousResearch/hermes-agent", files: JSON.parse("{" + files.replace(/,$/, "") + "}") };
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
' "$TAG" "$COMMIT" "$entries" > "$DEST/VENDORED.json"
if grep -nE "from '\./[^']+\.js'" "$DEST"/*.ts; then echo "rewrite missed a .js specifier" >&2; exit 1; fi
echo "vendored $TAG ($COMMIT) into src/vendor/hermes-gateway"
