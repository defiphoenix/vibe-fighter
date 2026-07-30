#!/usr/bin/env bash
#
# Phase 20 — regenerate the audio masters with the Higgsfield CLI.
#
#   bash scripts/gen-audio.sh              # only what is missing
#   bash scripts/gen-audio.sh --force ko   # re-generate specific cues (SPENDS CREDITS)
#
# Run from the repo root. Then: `npm run build:audio && npm run check:audio`.
#
# What this exists for: `concepts/**/*.mp3` is gitignored, so a fresh clone has the prompts and the job
# records but none of the masters. The first version of this script skipped whenever the JOB RECORD
# existed and never downloaded anything — so on a clone it regenerated nothing, fetched nothing, and
# `build-audio.py` then refused because every master was absent. It also omitted the music bed
# entirely. The skip is now keyed on the MASTER, and an existing record is REUSED rather than re-billed:
# `generate get <id>` restores a result URL for free.
#
# Cost, measured 2026-07-30: a full 14-cue regeneration billed ~25 credits. `higgsfield generate cost`
# UNDER-reports these audio models by roughly 6x, so do not trust its preflight for budgeting.
#
# Provenance discipline (docs/art-pipeline.md): stdout only into the .job.json — `2>&1` merges the CLI's
# `Error:` line into the JSON and corrupts it — and the record is written only after the call succeeds.

set -uo pipefail
D="concepts/audio/2026-07-30"
FORCE=0
[ "${1:-}" = "--force" ] && { FORCE=1; shift; }

CUES="hitLight hitHeavy block whiff jump land ko super roundStart roundEnd menuMove menuConfirm ambience"
BED="menuMusic"
WANT="${*:-$CUES $BED}"

# `sonilo_music` needs an explicit duration; `seed_audio` has no duration parameter at all and returns
# whatever length it likes (1.3 s to 30 s, measured). build-audio.py trims each cue to its first event,
# so that variance only matters for the beds.
gen() {
  local k="$1"
  if [ "$k" = "$BED" ]; then
    higgsfield generate create sonilo_music --prompt "$(cat "$D/$k.prompt.txt")" --duration 60 --wait --json
  else
    higgsfield generate create seed_audio --prompt "$(cat "$D/$k.prompt.txt")" \
      --format mp3 --sample_rate 44100 --wait --json
  fi
}

url_of() { python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
d=d[0] if isinstance(d,list) else d
print(d.get('result_url') or '')" "$1" 2>/dev/null; }

id_of() { python -c "
import json,sys
d=json.load(open(sys.argv[1],encoding='utf-8'))
d=d[0] if isinstance(d,list) else d
print(d.get('id') or '')" "$1" 2>/dev/null; }

fetch() { python -c "
import sys,urllib.request
urllib.request.urlretrieve(sys.argv[1], sys.argv[2])" "$1" "$2"; }

for k in $WANT; do
  master="$D/$k-raw.mp3"
  record="$D/$k.job.json"

  if [ -f "$master" ] && [ "$FORCE" = 0 ]; then echo "SKIP  $k (master present)"; continue; fi

  # A committed record means this cue was already paid for. Re-download rather than re-generate.
  if [ -f "$record" ] && [ "$FORCE" = 0 ]; then
    u="$(url_of "$record")"
    if [ -n "$u" ] && fetch "$u" "$master" 2>/dev/null; then echo "FETCH $k (reused record, 0 credits)"; continue; fi
    id="$(id_of "$record")"
    if [ -n "$id" ]; then
      u="$(higgsfield generate get "$id" --json 2>/dev/null | python -c "
import json,sys
try:
    d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d; print(d.get('result_url') or '')
except Exception: print('')")"
      if [ -n "$u" ] && fetch "$u" "$master" 2>/dev/null; then echo "FETCH $k (refreshed URL, 0 credits)"; continue; fi
    fi
    echo "STALE $k (record present, result no longer downloadable — regenerating)"
  fi

  echo "GEN   $k (spending credits)"
  if gen "$k" > "$D/.$k.tmp"; then
    mv "$D/.$k.tmp" "$record"
    u="$(url_of "$record")"
    if [ -n "$u" ] && fetch "$u" "$master"; then echo "OK    $k"; else echo "FAIL  $k (generated, download failed)"; fi
  else
    echo "FAIL  $k"; rm -f "$D/.$k.tmp"
  fi
done
echo "done — now run: npm run build:audio && npm run check:audio"
