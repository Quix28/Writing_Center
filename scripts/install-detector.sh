#!/bin/zsh
# Installs SlopTotal (local, offline AI-text detector, MIT) into the app's data folder, pinned to one commit.
# Needs git, uv and Python 3.10+. Models (~2 GB) download on the first check, into the same folder.
set -euo pipefail
COMMIT=adc3116d3df996064970133cd18efbfebe8eb937
DIR="$HOME/Library/Application Support/writing-centre/sloptotal"

mkdir -p "$DIR"
cd "$DIR"
if [ ! -d .git ]; then
  git init -q
  git remote add origin https://github.com/pablocaeg/sloptotal.git
fi
git fetch -q --depth 1 origin "$COMMIT"
git checkout -q --detach "$COMMIT"

[ -x .venv/bin/python ] || uv venv -q --python 3.11 .venv
# The requirements add PyTorch's CPU-only index for Linux; on macOS the normal PyPI build is the right one,
# and that extra index would shadow other packages, so install from PyPI alone.
grep -v '^--extra-index-url' requirements.txt > .venv/requirements-macos.txt
uv pip install -q --python .venv/bin/python -r .venv/requirements-macos.txt
echo "SlopTotal installed at $DIR (commit ${COMMIT:0:7})"
