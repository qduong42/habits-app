#!/usr/bin/env bash
# Ralph loop runner — fresh `claude -p` per plan task.
# Launch from the repo root: bash afk-loop.sh
# Parameterized via env (defaults = v1.2 night shift): PLAN, PROMPT_FILE, LOG,
# MAX_ITER, RETRY_SLEEP, DEFAULT_MODEL.
# Halts when: all plan checkboxes ticked, BLOCKED.md appears, or MAX_ITER reached.
#
# Model tiers (decided 2026-06-11): pure implementation defaults to Sonnet —
# the plan pins contracts/files/TDD steps and `npm run verify` is the
# backpressure, so the marginal value of a bigger model per iteration is low.
# Judgment-shaped tasks (QA passes, spec review, anything that must DETECT
# wrong instructions rather than follow them) override with a line inside the
# task block:   **Model:** fable     (or opus / sonnet)
set -u
cd "$(dirname "$0")"

PLAN=${PLAN:-docs/superpowers/plans/2026-06-11-v1.2-night.md}
PROMPT_FILE=${PROMPT_FILE:-PROMPT-v1.2.md}
LOG_DIR=docs/superpowers/ralph
LOG=${LOG:-$LOG_DIR/loop-v1.2.log}
MAX_ITER=${MAX_ITER:-20}
RETRY_SLEEP=${RETRY_SLEEP:-900} # 15 min — rides out usage-limit windows
DEFAULT_MODEL=${DEFAULT_MODEL:-claude-sonnet-4-6}

mkdir -p "$LOG_DIR"
echo "=== AFK loop started $(date) (max $MAX_ITER iterations, default model $DEFAULT_MODEL) ===" | tee -a "$LOG"

for i in $(seq 1 "$MAX_ITER"); do
  if [ -f "$LOG_DIR/BLOCKED.md" ]; then
    echo "BLOCKED.md present — halting. $(date)" | tee -a "$LOG"
    break
  fi
  # Anchored to list items at line start — the plan HEADER mentions "- [ ]"
  # in prose, which the unanchored grep matched forever (v1.2 night: 3 no-op
  # iterations after completion, loop only died via MAX_ITER).
  if ! grep -qE "^[[:space:]]*- \[ \]" "$PLAN"; then
    echo "All plan tasks ticked — done 🎉 $(date)" | tee -a "$LOG"
    break
  fi
  # First unchecked box's line number → the last task header above it.
  next_line=$(grep -nE "^[[:space:]]*- \[ \]" "$PLAN" | head -1 | cut -d: -f1)
  task_start=$(head -n "$next_line" "$PLAN" | grep -nE "^### Task" | tail -1 | cut -d: -f1)
  next_task=$(sed -n "${task_start}p" "$PLAN")

  # Model hint: scan only the next task's block (its header to the following
  # "### " heading); absent hint → DEFAULT_MODEL.
  task_block=$(tail -n +"${task_start:-1}" "$PLAN" | awk 'NR>1 && /^### /{exit} {print}')
  hint=$(printf '%s\n' "$task_block" | grep -oiE '\*\*Model:\*\*[[:space:]]*(fable|opus|sonnet)' | head -1 | grep -oiE '(fable|opus|sonnet)' | tr '[:upper:]' '[:lower:]')
  case "$hint" in
    fable) model=claude-fable-5 ;;
    opus) model=claude-opus-4-8 ;;
    sonnet) model=claude-sonnet-4-6 ;;
    *) model=$DEFAULT_MODEL ;;
  esac

  echo "--- iteration $i/$MAX_ITER $(date) — next: ${next_task:-?} [model: $model]" | tee -a "$LOG"
  claude -p "$(cat "$PROMPT_FILE")" --model "$model" --dangerously-skip-permissions >>"$LOG" 2>&1
  status=$?
  echo "--- iteration $i exit code $status" | tee -a "$LOG"
  if [ "$status" -ne 0 ]; then
    echo "--- failed; sleeping ${RETRY_SLEEP}s before retry" | tee -a "$LOG"
    sleep "$RETRY_SLEEP"
  fi
done
echo "=== AFK loop ended $(date) ===" | tee -a "$LOG"
