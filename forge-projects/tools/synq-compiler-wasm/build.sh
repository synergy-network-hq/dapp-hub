#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd "$script_dir/../.." && pwd)"
source_dir="$(cd "$app_dir/../../synq-language" && pwd)"
expected_revision=01125b6470c6b49c586b7a28fe054a62e1c913c6
if [ "$(git -C "$source_dir" rev-parse HEAD)" != "$expected_revision" ]; then
  echo 'SynQ checkout does not match the saved reviewed compiler revision' >&2; exit 1
fi
git -C "$source_dir" diff --exit-code -- compiler vm
artifact_dir="$(mktemp -d)"
trap 'rm -rf "$artifact_dir"' EXIT
wasm-pack build "$script_dir" --target web --release --no-opt --out-dir "$artifact_dir" --out-name synq_compiler --locked
mkdir -p "$app_dir/assets/compiler" "$app_dir/src/lib/ide/generated"
cp "$artifact_dir/synq_compiler.js" "$app_dir/src/lib/ide/generated/synq_compiler.js"
cp "$artifact_dir/synq_compiler.d.ts" "$app_dir/src/lib/ide/generated/synq_compiler.d.ts"
cp "$artifact_dir/synq_compiler_bg.wasm" "$app_dir/assets/compiler/synq_compiler_bg.wasm"

python3 - "$app_dir/src/lib/ide/generated/synq_compiler.js" <<'PYTHON'
import sys
from pathlib import Path
p=Path(sys.argv[1]);p.write_text(p.read_text().replace("new URL('synq_compiler_bg.wasm', import.meta.url)","new URL('../../../../assets/compiler/synq_compiler_bg.wasm', import.meta.url)"))
PYTHON
