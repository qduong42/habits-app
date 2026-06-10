#!/usr/bin/env bash
# Ralph loop runner — fresh `claude -p` per plan task, v1.2 night shift.
# Launch from the repo root: bash afk-loop.sh
# Halts when: all plan checkboxes ticked, BLOCKED.md appears, or MAX_ITER reached.
set -u
cd "$(dirname "$0")"

PLAN=docs/superpowers/plans/2026-06-11-v1.2-night.md
PROMPT_FILE=PROMPT-v1.2.md
LOG_DIR=docs/superpowers/ralph
LOG="$LOG_DIR/loop-v1.2.log"
MAX_ITER=${MAX_ITER:-20}
RETRY_SLEEP=${RETRY_SLEEP:-900} # 15 min — rides out usage-limit windows

mkdir -p "$LOG_DIR"
echo "=== AFK loop started $(date) (max $MAX_ITER iterations) ===" | tee -a "$LOG"

for i in $(seq 1 "$MAX_ITER"); do
  if [ -f "$LOG_DIR/BLOCKED.md" ]; then
    echo "BLOCKED.md present — halting. $(date)" | tee -a "$LOG"
    break
  fi
  if ! grep -q -- "- \[ \]" "$PLAN"; then
    echo "All plan tasks ticked — done 🎉 $(date)" | tee -a "$LOG"
    break
  fi
  next_task=$(grep -B 20 -- "- \[ \]" "$PLAN" | grep -o "^### Task [0-9]*:.*" | tail -1)
  echo "--- iteration $i/$MAX_ITER $(date) — next: ${next_task:-?}" | tee -a "$LOG"
  claude -p "$(cat "$PROMPT_FILE")" --dangerously-skip-permissions >>"$LOG" 2>&1
  status=$?
  echo "--- iteration $i exit code $status" | tee -a "$LOG"
  if [ "$status" -ne 0 ]; then
    echo "--- failed; sleeping ${RETRY_SLEEP}s before retry" | tee -a "$LOG"
    sleep "$RETRY_SLEEP"
  fi
done
echo "=== AFK loop ended $(date) ===" | tee -a "$LOG"
