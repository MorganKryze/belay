#!/usr/bin/env bash
# The iPhone UI test classes, split into eight shards of close duration for CI.
#   ui-shards.sh <1-8>   print the shard's -only-testing arguments, one per line
#   ui-shards.sh check   fail when a test class in BelayUITests is in no shard, or in two
# The split balances the classes' measured run times: about 21 minutes each on a local Mac, about
# twice that on a CI runner.
# A new class goes in the shortest shard. WatchLinkTests reads the app's recording link, not a
# paired watch, so it runs here; the watch app's own UI tests need a paired watch and stay off CI.
set -euo pipefail
SHARD1="AccessibilityAuditTests SessionToolsTests ProfileTests"
SHARD2="SeancesProgrammeTests SignOutTests OldAppDataTests TitleTests"
SHARD3="BodyToolsTests CorpsTests ActivityTests"
SHARD4="PauseTests RestToneTests SyncNoticeTests"
SHARD5="UnitsTests ReglagesTests AccueilTests"
SHARD6="EntriesTests SummaryTests SignInTests ShellTests"
SHARD7="OutilsTests ExercisesTests SessionFlowTests"
SHARD8="SeancesHistoryTests TrendTests WatchLinkTests ExerciseEndTests"
ALL="$SHARD1 $SHARD2 $SHARD3 $SHARD4 $SHARD5 $SHARD6 $SHARD7 $SHARD8"
DIR="$(cd "$(dirname "$0")/../BelayUITests" && pwd)"

case "${1:-}" in
  [1-8]) eval "LIST=\$SHARD$1" ;;
  check)
    listed="$(printf '%s\n' $ALL | sort)"
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
  *) echo "usage: ui-shards.sh <1-8> | check" >&2; exit 2 ;;
esac
for c in $LIST; do echo "-only-testing:BelayUITests/$c"; done
