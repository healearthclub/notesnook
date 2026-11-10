#!/usr/bin/env bash
set -euo pipefail

mobile_dir="$(cd "$(dirname "$0")/.." && pwd)"
repo_dir="$(cd "$mobile_dir/../.." && pwd)"
export RELEASE_DIR="${RELEASE_DIR:-$mobile_dir/ios/build/releases}"

: "${APPLE_TEAM_ID:?Set the Apple Developer team ID}"
: "${MAIN_PROFILE:?Set the main app App Store Connect profile name}"
: "${WIDGET_PROFILE:?Set the widget App Store Connect profile name}"
: "${SHARE_PROFILE:?Set the share extension App Store Connect profile name}"

mkdir -p "$RELEASE_DIR"
cd "$repo_dir"

case "${1:-archive}" in
  archive)
    if ! security find-identity -v -p codesigning | grep -q 'Apple Distribution:'; then
      echo 'Install an Apple Distribution identity, including its private key.' >&2
      exit 1
    fi
    # Use the monorepo runner to build the editor and local package graph.
    node scripts/execute.mjs mobile:build
    ENVFILE=.env.public xcodebuild \
      -workspace "$mobile_dir/ios/Notesnook.xcworkspace" \
      -scheme Notesnook -configuration Release \
      -destination 'generic/platform=iOS' \
      -archivePath "$RELEASE_DIR/Notesnook.xcarchive" \
      "IOS_FORK_TEAM_ID=$APPLE_TEAM_ID" \
      "IOS_MAIN_PROFILE=$MAIN_PROFILE" \
      "IOS_WIDGET_PROFILE=$WIDGET_PROFILE" \
      "IOS_SHARE_PROFILE=$SHARE_PROFILE" \
      archive 2>&1 | tee "$RELEASE_DIR/archive.log"
    ;;
  export)
    python3 - "$mobile_dir/ios/build-configs/ios-build.active.xcconfig" <<'PY'
import os, pathlib, plistlib, sys
values = {}
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('//'):
        key, value = line.split('=', 1)
        values[key.strip()] = value.strip()
options = {
    'method': 'app-store-connect',
    'destination': 'export',
    'teamID': os.environ['APPLE_TEAM_ID'],
    'signingStyle': 'manual',
    'signingCertificate': 'Apple Distribution',
    'manageAppVersionAndBuildNumber': False,
    'provisioningProfiles': {
        values['IOS_MAIN_BUNDLE_ID']: os.environ['MAIN_PROFILE'],
        values['IOS_WIDGET_BUNDLE_ID']: os.environ['WIDGET_PROFILE'],
        values['IOS_SHARE_BUNDLE_ID']: os.environ['SHARE_PROFILE'],
    },
}
path = pathlib.Path(os.environ['RELEASE_DIR']) / 'ExportOptions.plist'
path.write_bytes(plistlib.dumps(options))
PY
    xcodebuild -exportArchive \
      -archivePath "$RELEASE_DIR/Notesnook.xcarchive" \
      -exportOptionsPlist "$RELEASE_DIR/ExportOptions.plist" \
      -exportPath "$RELEASE_DIR/export" \
      2>&1 | tee "$RELEASE_DIR/export.log"
    ;;
  *)
    echo 'Usage: bash apps/mobile/scripts/ios-release.sh [archive|export]' >&2
    exit 2
    ;;
esac
