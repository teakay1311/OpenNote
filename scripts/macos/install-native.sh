#!/bin/bash
set -euo pipefail

if [[ "$(uname -s)/$(uname -m)" != Darwin/arm64 || ! -f bun.lock || ! -d node_modules ]]; then
  echo "Chạy script này trên macOS Apple Silicon, trong thư mục chứa bun.lock sau khi cài dependencies." >&2
  exit 1
fi

archive="$(mktemp "${TMPDIR:-/tmp}/opennote-native.XXXXXXXX")"
trap 'rm -f -- "$archive"' EXIT

# Bun can skip optional Darwin packages in a lockfile created on another OS.
for native in @next/swc-darwin-arm64 @tailwindcss/oxide-darwin-arm64 lightningcss-darwin-arm64; do
  [[ -f "node_modules/$native/package.json" ]] && continue
  entry="$(bun -e 'const [, url, , digest] = Bun.JSONC.parse(await Bun.file("bun.lock").text()).packages[process.argv[1]]; console.log(url, digest)' "$native")"
  read -r url expected <<< "$entry"
  [[ "$url" == https://registry.npmjs.com/* || "$url" == https://registry.npmjs.org/* ]]
  echo "Cài gói native ARM64 theo lockfile: $native"
  curl --fail --silent --show-error --location --retry 2 --max-time 180 \
    "${url/registry.npmjs.com/registry.npmjs.org}" -o "$archive"
  digest="$(/usr/bin/openssl dgst -sha512 -binary "$archive" | /usr/bin/openssl base64 -A)"
  if [[ "sha512-$digest" != "$expected" ]]; then
    echo "SHA-512 không khớp cho $native." >&2
    exit 1
  fi
  mkdir -p "node_modules/$native"
  /usr/bin/tar -xf "$archive" -C "node_modules/$native" --strip-components=1
done
