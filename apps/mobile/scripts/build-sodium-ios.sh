#!/usr/bin/env bash
set -euo pipefail

# The dependency ships ARM64 for devices and x86_64 for simulators, but no
# Apple Silicon simulator slice. Preserve those shipped slices and add an
# ARM64 simulator build of the identical libsodium version.
mobile_dir="$(cd "$(dirname "$0")/.." && pwd)"
package_dir="$mobile_dir/node_modules/@ammarahmed/react-native-sodium"
original="$package_dir/libsodium/libsodium-ios/lib/libsodium.a"
headers="$package_dir/libsodium/libsodium-ios/include"
framework="$package_dir/libsodium/Sodium.xcframework"
source_commit=c943d18f387e442cf800e32c50c9bd60ae606e68
source_sha=47b35fc0c67cdc630d711f5f247a0f132dbadf3e48a6d674e23586939b0a27fe
sdk_path="$(xcrun --sdk iphonesimulator --show-sdk-path)"
fingerprint="$source_commit|$sdk_path|$(shasum -a 256 "$original" | cut -d ' ' -f 1)"

if [[ -f "$framework/.fork-build" ]] && [[ "$(cat "$framework/.fork-build")" == "$fingerprint" ]]; then
  echo 'Using cached libsodium device/simulator XCFramework.'
  exit 0
fi

grep -q 'SODIUM_VERSION_STRING "1.0.17"' "$headers/sodium/version.h" || {
  echo 'Review this build script before using a different libsodium version.' >&2
  exit 1
}
for tool in autoconf automake glibtoolize; do
  command -v "$tool" >/dev/null || {
    echo 'Install build dependencies: brew install autoconf automake libtool' >&2
    exit 1
  }
done

build_dir="$mobile_dir/ios/build/sodium"
mkdir -p "$build_dir"
archive="$build_dir/libsodium-1.0.17.tar.gz"
if [[ ! -f "$archive" ]]; then
  curl -fL --retry 2 \
    "https://codeload.github.com/jedisct1/libsodium/tar.gz/$source_commit" \
    -o "$archive"
fi
printf '%s  %s\n' "$source_sha" "$archive" | shasum -a 256 -c -
source_dir="$build_dir/libsodium-$source_commit"
if [[ ! -f "$source_dir/configure" ]]; then
  tar -xzf "$archive" -C "$build_dir"
  (cd "$source_dir" && ./autogen.sh)
fi

mkdir -p "$build_dir/arm64-simulator" "$build_dir/device" "$build_dir/simulator"
(
  cd "$build_dir/arm64-simulator"
  export CC="$(xcrun --sdk iphonesimulator -f clang)"
  export CFLAGS="-target arm64-apple-ios15.1-simulator -isysroot $sdk_path -O2"
  export LDFLAGS="-target arm64-apple-ios15.1-simulator -isysroot $sdk_path"
  "$source_dir/configure" --host=aarch64-apple-darwin \
    --enable-static --disable-shared --enable-minimal --disable-asm \
    --prefix="$build_dir/install"
  make -j "${SODIUM_BUILD_JOBS:-4}"
  make install
)

xcrun lipo "$original" -thin arm64 -output "$build_dir/device/libsodium.a"
xcrun lipo "$original" -thin x86_64 -output "$build_dir/simulator/libsodium-x86_64.a"
xcrun lipo -create "$build_dir/install/lib/libsodium.a" \
  "$build_dir/simulator/libsodium-x86_64.a" -output "$build_dir/simulator/libsodium.a"

# Only remove this generated framework; never alter the dependency's original .a.
if [[ -d "$framework" ]]; then rm -rf "$framework"; fi
xcodebuild -create-xcframework \
  -library "$build_dir/device/libsodium.a" -headers "$headers" \
  -library "$build_dir/simulator/libsodium.a" -headers "$headers" \
  -output "$framework"
printf '%s\n' "$fingerprint" > "$framework/.fork-build"
