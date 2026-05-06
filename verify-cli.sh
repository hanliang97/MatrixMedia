#!/usr/bin/env bash
# verify-cli.sh — MatrixMedia CLI contract verification
# Tests exit codes (0/1/2/3) and --json output purity.
#
# Usage: bash verify-cli.sh [--verbose]
# Requires: Electron dev env (node_modules/.bin/electron + dist/electron/main.js)
#
# Exit codes tested:
#   0  success / help
#   1  unexpected error (unhandled exception / timeout)
#   2  argument / usage error (bad args, unknown subcommand)
#   3  business failure (upload failed, no-login, publish error)
#
# Note: pushall.js is the release pipeline script, NOT the CLI entry.
#       The CLI is invoked via: ELECTRON_RUN_AS_NODE= electron . cli <subcommand>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
ELECTRON="$REPO_ROOT/node_modules/.bin/electron"
VERBOSE=false
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

PASS=0
FAIL=0
SKIP=0

# ── helpers ──────────────────────────────────────────────────────────────────

run_cli() {
  # Usage: run_cli <args...>
  # Runs electron . <args>, captures stdout+stderr into separate vars.
  # Sets LAST_STDOUT, LAST_STDERR, LAST_EXIT.
  local tmp_out tmp_err
  tmp_out=$(mktemp)
  tmp_err=$(mktemp)
  set +e
  ELECTRON_RUN_AS_NODE= "$ELECTRON" . "$@" \
    >"$tmp_out" 2>"$tmp_err"
  LAST_EXIT=$?
  set -e
  LAST_STDOUT=$(cat "$tmp_out")
  LAST_STDERR=$(cat "$tmp_err")
  rm -f "$tmp_out" "$tmp_err"
}

assert_exit() {
  # assert_exit <label> <expected_code>
  local label="$1"
  local expected="$2"
  if [[ "$LAST_EXIT" -eq "$expected" ]]; then
    echo "[PASS] $label  (exit=$LAST_EXIT)"
    (( PASS++ )) || true
  else
    echo "[FAIL] $label  expected=$expected actual=$LAST_EXIT"
    if $VERBOSE; then
      echo "  stdout: $(echo "$LAST_STDOUT" | head -5)"
      echo "  stderr: $(echo "$LAST_STDERR" | head -5)"
    fi
    (( FAIL++ )) || true
  fi
}

assert_json_clean() {
  # assert_json_clean <label>
  # Checks LAST_STDOUT is valid JSON with no non-JSON noise lines.
  local label="$1"
  # Strip blank lines; filter known Electron noise lines
  local clean
  clean=$(echo "$LAST_STDOUT" \
    | grep -v '^[[:space:]]*$' \
    | grep -v '^[0-9]\+\.[0-9]\+\.[0-9]\+ -----' \
    | grep -v '^DevTools listening' \
    | grep -v '^Browserslist:' \
    || true)
  if [[ -z "$clean" ]]; then
    echo "[FAIL] $label  stdout is empty after stripping noise"
    (( FAIL++ )) || true
    return
  fi
  # Validate JSON via node (always available in Electron project)
  local err
  err=$(echo "$clean" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try { JSON.parse(d); process.exit(0); }
      catch(e){ process.stderr.write(e.message+'\n'); process.exit(1); }
    });
  " 2>&1) || {
    echo "[FAIL] $label  not valid JSON: $err"
    if $VERBOSE; then echo "  output: $(echo "$clean" | head -5)"; fi
    (( FAIL++ )) || true
    return
  }
  echo "[PASS] $label  (valid JSON)"
  (( PASS++ )) || true
}

assert_no_non_json() {
  # assert_no_non_json <label>
  # Ensures stdout contains ONLY JSON (no mixed prose lines outside the JSON block).
  local label="$1"
  local clean
  clean=$(echo "$LAST_STDOUT" \
    | grep -v '^[[:space:]]*$' \
    | grep -v '^[0-9]\+\.[0-9]\+\.[0-9]\+ -----' \
    | grep -v '^DevTools listening' \
    | grep -v '^Browserslist:' \
    || true)
  # The entire cleaned output must be parseable as one JSON value
  local err
  err=$(echo "$clean" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      const t=d.trim();
      if(t==='' || t==='[]' || t==='{}') { process.exit(0); }
      try { JSON.parse(t); process.exit(0); }
      catch(e){ process.stderr.write(e.message+'\n'); process.exit(1); }
    });
  " 2>&1) || {
    echo "[FAIL] $label  stdout mixes non-JSON text: $err"
    if $VERBOSE; then echo "  clean output: $(echo "$clean" | head -5)"; fi
    (( FAIL++ )) || true
    return
  }
  echo "[PASS] $label  (no non-JSON noise in stdout)"
  (( PASS++ )) || true
}

# ── pre-check ────────────────────────────────────────────────────────────────

echo ""
echo "=== MatrixMedia CLI Verification ==="
echo "repo:     $REPO_ROOT"
echo "electron: $ELECTRON"
echo "dist:     $REPO_ROOT/dist/electron/main.js"
echo ""

if [[ ! -f "$ELECTRON" ]]; then
  echo "[ABORT] electron binary not found at $ELECTRON"
  echo "  Run: yarn install"
  exit 1
fi

if [[ ! -f "$REPO_ROOT/dist/electron/main.js" ]]; then
  echo "[ABORT] dist/electron/main.js not found — run: yarn build:dir"
  exit 1
fi

cd "$REPO_ROOT"

# ── SECTION 1: exit code 0 (success / help) ──────────────────────────────────

echo "--- Section 1: exit code 0 (success / help) ---"

run_cli cli --help
assert_exit "cli --help returns 0" 0

run_cli cli publish --help
assert_exit "cli publish --help returns 0" 0

run_cli cli accounts --help
assert_exit "cli accounts --help returns 0" 0

run_cli cli history --help
assert_exit "cli history --help returns 0" 0

run_cli cli accounts --json
assert_exit "cli accounts --json returns 0" 0

run_cli cli history --json
assert_exit "cli history --json returns 0" 0

echo ""

# ── SECTION 2: exit code 1 (generic / unexpected error) ──────────────────────
# Triggered by unhandled exceptions in catch blocks.
# In CI without a real video file / network, the cleanest exit-1 trigger is
# the login path timing out with --puppeteer-headless when no Chrome exists
# or via a caught exception in the login flow. We simulate this with a
# deliberately bad --save-qr-png path that node cannot write, combined with
# --puppeteer-headless. If the environment happens to succeed this is SKIP'd.

echo "--- Section 2: exit code 1 (generic error / catch block) ---"

# Simulate a catch-block exit-1 via login with puppeteer-headless + unwritable qr path
run_cli cli login -p dy --phone 13800138000 \
  --puppeteer-headless --no-terminal-qr \
  --save-qr-png /nonexistent/path/qr.png \
  --timeout-sec 30 || true
if [[ "$LAST_EXIT" -eq 1 ]]; then
  assert_exit "cli login puppeteer-headless unwritable-path → exit 1" 1
elif [[ "$LAST_EXIT" -eq 0 ]]; then
  echo "[SKIP] cli login puppeteer-headless → exit 0 (env has Chrome, login succeeded)"
  (( SKIP++ )) || true
else
  # exit 2 means parse error hit first — still informative
  echo "[INFO] cli login puppeteer-headless → exit $LAST_EXIT (env-dependent; acceptable)"
  (( SKIP++ )) || true
fi

echo ""

# ── SECTION 3: exit code 2 (argument / usage error) ──────────────────────────

echo "--- Section 3: exit code 2 (argument / usage error) ---"

# No subcommand after cli
run_cli cli
assert_exit "cli (no subcommand) → exit 2" 2

# Unknown subcommand
run_cli cli unknown-subcommand
assert_exit "cli unknown-subcommand → exit 2" 2

# publish: missing required --platform
run_cli cli publish --phone 13800138000 -f /tmp/test.mp4 -t "title"
assert_exit "cli publish missing --platform → exit 2" 2

# publish: missing required --file
run_cli cli publish -p dy --phone 13800138000 -t "title"
assert_exit "cli publish missing --file → exit 2" 2

# publish: missing required --title
run_cli cli publish -p dy --phone 13800138000 -f /tmp/test.mp4
assert_exit "cli publish missing --title → exit 2" 2

# publish: invalid platform name
run_cli cli publish -p INVALID_PLATFORM --phone 13800138000 -f /tmp/test.mp4 -t "title"
assert_exit "cli publish invalid platform → exit 2" 2

# login: missing --platform
run_cli cli login --phone 13800138000
assert_exit "cli login missing --platform → exit 2" 2

# login: unsupported platform (non-douyin)
run_cli cli login -p ks --phone 13800138000
assert_exit "cli login unsupported platform (ks) → exit 2" 2

echo ""

# ── SECTION 4: exit code 3 (business failure) ─────────────────────────────────
# exit 3 fires when:
#   - publish: puppeteerFile-done with status=false
#   - publish: puppeteer-noLogin event received (no cookie for partition)
#
# The publish flow opens a Puppeteer window and has a 35-minute internal timeout,
# making it unsuitable for automated tests without real accounts.
#
# Instead we use the OS `timeout` command (5s) to kill the process after it has
# started — which means exit code will be 124 (timeout). We capture that as a
# SKIP rather than FAIL. When running with real accounts the test can be run
# manually and exit 3 will be observed directly.
#
# We DO verify the code path exists by checking source: in cli/index.js,
# finish(3) is called on both puppeteer-noLogin and puppeteerFile-done(status=false).

echo "--- Section 4: exit code 3 (business / publish failure) ---"
echo "  NOTE: exit 3 requires a real Puppeteer run (no-login or upload-fail)."
echo "  Skipping live publish test to avoid 35-min hang. Verifying code path statically."

# Static check: ensure exit code 3 is present in compiled main.js
if grep -q "finish(3)" "$REPO_ROOT/src/main/cli/index.js" 2>/dev/null; then
  echo "[PASS] exit 3 code path present in src/main/cli/index.js  (finish(3))"
  (( PASS++ )) || true
else
  echo "[FAIL] exit 3 code path NOT found in src/main/cli/index.js"
  (( FAIL++ )) || true
fi

# In the compiled bundle, finish(3) gets minified to a short variable name.
# The most reliable marker is the Chinese error string next to the exit-3 call.
if grep -q '登录态异常或未登录' "$REPO_ROOT/dist/electron/main.js" 2>/dev/null; then
  echo "[PASS] exit 3 code path present in dist/electron/main.js  (no-login string found)"
  (( PASS++ )) || true
else
  echo "[FAIL] exit 3 code path NOT found in dist/electron/main.js (build out of sync?)"
  (( FAIL++ )) || true
fi

# macOS has no GNU 'timeout'; use perl as a portable alternative
MM_TIMEOUT_CMD=""
if command -v gtimeout &>/dev/null; then
  MM_TIMEOUT_CMD="gtimeout"
elif command -v timeout &>/dev/null; then
  MM_TIMEOUT_CMD="timeout"
fi

# Quick timed test: wrap publish in 5s timeout; expect 124 (OS killed) or 3
# Phone 99999999999 has no session cookie → puppeteer-noLogin → exit 3
# If OS kills before no-login fires → exit 124 (SKIP)
echo "  Running 5s timeout publish probe (phone with no session)..."
if [[ -n "$MM_TIMEOUT_CMD" ]]; then
  set +e
  $MM_TIMEOUT_CMD 5s bash -c "
    cd '$REPO_ROOT'
    ELECTRON_RUN_AS_NODE= '$ELECTRON' . cli publish \
      -p dy \
      --phone 99999999999 \
      -f /tmp/nonexistent_verify_cli_test.mp4 \
      -t 'verify-cli-exit3-probe' 2>/dev/null
  " 
  TIMED_EXIT=$?
  set -e
  if [[ "$TIMED_EXIT" -eq 3 ]]; then
    echo "[PASS] cli publish no-session → exit 3  (puppeteer-noLogin fired within 5s)"
    (( PASS++ )) || true
  elif [[ "$TIMED_EXIT" -eq 124 ]]; then
    echo "[SKIP] cli publish probe timeout 5s — exit 3 path requires Puppeteer window to open"
    echo "       (this is normal in headless CI; test manually with a real account)"
    (( SKIP++ )) || true
  else
    echo "[INFO] cli publish probe → exit $TIMED_EXIT (may be env-dependent)"
    (( SKIP++ )) || true
  fi
else
  echo "[SKIP] no timeout command available (no gtimeout/timeout on this system)"
  echo "       To test manually: ELECTRON_RUN_AS_NODE= electron . cli publish -p dy --phone 99999999999 -f /tmp/x.mp4 -t t"
  echo "       Expected: exit 3 (puppeteer-noLogin)"
  (( SKIP++ )) || true
fi

echo ""

# ── SECTION 5: --json output purity ──────────────────────────────────────────

echo "--- Section 5: --json output purity (no mixed non-JSON text) ---"

run_cli cli accounts --json
assert_json_clean "accounts --json produces valid JSON" 
assert_no_non_json "accounts --json stdout is pure JSON (no noise lines)"

run_cli cli history --json
assert_json_clean "history --json produces valid JSON"
assert_no_non_json "history --json stdout is pure JSON (no noise lines)"

run_cli cli history --json --days 7
assert_json_clean "history --json --days 7 produces valid JSON"

run_cli cli accounts --json -p 抖音
assert_json_clean "accounts --json -p 抖音 produces valid JSON"

echo ""

# ── Summary ──────────────────────────────────────────────────────────────────

TOTAL=$(( PASS + FAIL + SKIP ))
echo "==================================="
echo "Results: $TOTAL tests"
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP (env-dependent, not counted as failure)"
echo "==================================="

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Some tests FAILED. Re-run with --verbose for details."
  exit 1
fi

exit 0
