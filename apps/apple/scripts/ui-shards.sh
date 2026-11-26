#!/usr/bin/env bash
# The iPhone UI test classes, split into four shards of close duration for CI.
#   ui-shards.sh <1-4>   print the shard's -only-testing arguments, one per line
#   ui-shards.sh check   fail when a test class in BelayUITests is in no shard, or in two
# The split balances the classes' measured run times (about 43 minutes each on a local Mac).
# A new class goes in the shortest shard. WatchLinkTests reads the app's recording link, not a
# paired watch, so it runs here; the watch app's own UI tests need a paired watch and stay off CI.
set -euo pipefail
SHARD1="AccessibilityAuditTests SessionToolsTests ProfileTests SeancesProgrammeTests SignOutTests OldAppDataTests TitleTests"
SHARD2="BodyToolsTests CorpsTests ActivityTests PauseTests RestToneTests SyncNoticeTests"
SHARD3="UnitsTests ReglagesTests AccueilTests EntriesTests SummaryTests SignInTests ShellTests"
SHARD4="OutilsTests ExercisesTests SessionFlowTests SeancesHistoryTests TrendTests WatchLinkTests ExerciseEndTests"
DIR="$(cd "$(dirname "$0")/../BelayUITests" && pwd)"

case "${1:-}" in
  1) LIST=$SHARD1 ;;
  2) LIST=$SHARD2 ;;
  3) LIST=$SHARD3 ;;
  4) LIST=$SHARD4 ;;
  check)
    listed="$(printf '%s\n' $SHARD1 $SHARD2 $SHARD3 $SHARD4 | sort)"
    found="$(grep -hoE 'class [A-Za-z0-9_]+ *: *XCTestCase' "$DIR"/*.swift | sed -E 's/class ([A-Za-z0-9_]+).*/\1/' | sort)"
    dup="$(printf '%s\n' "$listed" | uniq -d)"
    missing="$(comm -23 <(printf '%s\n' "$found") <(printf '%s\n' "$listed" | uniq))"
    gone="$(comm -13 <(printf '%s\n' "$found") <(printf '%s\n' "$listed" | uniq))"
    [ -z "$dup" ] || echo "in two shards: $dup"
    [ -z "$missing" ] || echo "in no shard (add to apps/apple/scripts/ui-shards.sh): $missing"
    [ -z "$gone" ] || echo "listed but not found: $gone"
    [ -z "$dup$missing$gone" ] && echo "$(printf '%s\n' "$found" | wc -l | tr -d ' ') classes, each in one shard"
    [ -z "$dup$missing$gone" ]
    exit ;;
  *) echo "usage: ui-shards.sh <1-4> | check" >&2; exit 2 ;;
esac
for c in $LIST; do echo "-only-testing:BelayUITests/$c"; done
