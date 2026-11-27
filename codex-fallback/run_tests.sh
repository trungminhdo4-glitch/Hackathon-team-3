#!/bin/sh
set -eu
PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RUN_ID=v12-$(date +%Y%m%d-%H%M%S)-$$
exec python3 "$PROJECT_DIR/agent.py" run "$PROJECT_DIR/inputs/all_tests.json" --out "$PROJECT_DIR/runs/test-$RUN_ID" --minutes 40 --workers 3 --model-concurrency 2 "$@"
