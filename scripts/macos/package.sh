#!/bin/bash
set -euo pipefail
export COPYFILE_DISABLE=1 NEXT_TELEMETRY_DISABLED=1

root="$(cd "$(dirname "$0")/../.." && pwd)"
bun_bin="$(command -v bun)"
if [[ "$(uname -s)/$(uname -m)" != Darwin/arm64 || "$("$bun_bin" --version)" != 1.3.14 ]]; then
  echo "Cần macOS Apple Silicon và Bun 1.3.14." >&2
  exit 1
fi
stage="$(mktemp -d "${TMPDIR:-/tmp}/opennote-package.XXXXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
mkdir -p "$stage/source" "$stage/image/OpenNote.app"
source="$stage/source"
app="$stage/image/OpenNote.app"
contents="$app/Contents"
resources="$contents/Resources"
payload="$resources/server"
mkdir -p "$contents/MacOS" "$contents/Helpers" "$payload"
for item in package.json bun.lock next.config.ts tsconfig.json eslint.config.mjs \
            postcss.config.mjs tailwind.config.ts components.json src prisma tests; do
  /usr/bin/ditto "$root/$item" "$source/$item"
done
if [[ -d "$root/public" ]]; then
  /usr/bin/ditto "$root/public" "$source/public"
fi
cd "$source"
version="$("$bun_bin" -p 'require("./package.json").version')"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
artifact="OpenNote-${version}-macos-arm64"
export DATABASE_URL="file:$stage/build.db"
"$bun_bin" install --frozen-lockfile
bash "$root/scripts/macos/install-native.sh"
"$bun_bin" run db:generate
"$bun_bin" run lint
"$bun_bin" run --bun tsc --noEmit --incremental false
"$bun_bin" test
"$bun_bin" run build
"$bun_bin" run prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > "$resources/empty-schema.sql"
/usr/bin/sqlite3 -bail "$stage/schema-check.db" < "$resources/empty-schema.sql"
test "$(/usr/bin/sqlite3 "$stage/schema-check.db" "SELECT count(*) FROM sqlite_schema WHERE type='table' AND name IN ('Folder','Note','TrashAction')")" = 3

# Next can trace project sources along with runtime. Select only runtime roots.
for item in .next node_modules server.js package.json; do
  /usr/bin/ditto ".next/standalone/$item" "$payload/$item"
done
if [[ -d .next/standalone/public ]]; then
  /usr/bin/ditto .next/standalone/public "$payload/public"
fi
# Source maps can embed the original source. Trace files are build inputs only.
find "$payload" -type f \( -name '*.map' -o -name '*.nft.json' \) -delete
cp "$root/scripts/macos/server-lifetime.cjs" "$payload/"
cp "$root/prisma/upgrade-trash-undo.sql" "$resources/"
cp "$bun_bin" "$contents/Helpers/bun"
chmod 755 "$contents/Helpers/bun"

icon_png="$stage/OpenNote-Icon-1024.png"
iconset="$stage/OpenNote.iconset"
mkdir -p "$iconset"
/usr/bin/sips -s format png "$source/public/opennote.svg" --out "$icon_png" >/dev/null
for size in 16 32 128 256 512; do
  double=$((size * 2))
  /usr/bin/sips -z "$size" "$size" "$icon_png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
  /usr/bin/sips -z "$double" "$double" "$icon_png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
/usr/bin/iconutil --convert icns --output "$resources/OpenNote.icns" "$iconset"

cat > "$contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>local.opennote.app</string>
  <key>CFBundleName</key><string>OpenNote</string>
  <key>CFBundleDisplayName</key><string>OpenNote</string>
  <key>CFBundleExecutable</key><string>OpenNote</string>
  <key>CFBundleIconFile</key><string>OpenNote.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
/usr/bin/plutil -lint "$contents/Info.plist"
/usr/bin/xcrun swiftc -O -module-cache-path "$stage/swift-cache" -target arm64-apple-macos13.0 \
  "$root/scripts/macos/main.swift" "$root/scripts/macos/Database.swift" -o "$contents/MacOS/OpenNote"

if [[ -n "$(find "$app" \( -name '.env*' -o -name '.git' -o -name '.DS_Store' -o -name 'tool-results' \
  -o -name '*.db' -o -name '*.db-*' -o -name '*.sqlite' -o -name '*.sqlite-*' -o -name '*.sqlite3' -o -name '*.sqlite3-*' \
  -o -name '*.log' -o -name '*.pid' -o -name '.cache' -o -name 'cache' -o -name 'tests' -o -name 'test' \
  -o -name '*.test.*' -o -name '*.spec.*' -o -name '*.ts' -o -name '*.tsx' -o -name '*.map' \) -print)" ]]; then
  echo "Gói chứa tệp ngoài danh sách runtime." >&2
  find "$app" \( -name '.env*' -o -name '*.db*' -o -name '*.sqlite*' -o -name '*.log' -o -name '*cache*' -o -name '*test*' \) -print >&2
  exit 1
fi
"$bun_bin" -e '
  import { lstatSync, readdirSync, realpathSync } from "node:fs";
  import { join } from "node:path";
  const root = realpathSync(process.argv[1]);
  function verify(directory) {
    for (const name of readdirSync(directory)) {
      const item = join(directory, name);
      const info = lstatSync(item);
      if (info.isSymbolicLink() && !realpathSync(item).startsWith(root + "/")) {
        throw new Error("Liên kết ngoài gói: " + item);
      }
      if (info.isDirectory()) verify(item);
    }
  }
  verify(root);
' "$app"
while IFS= read -r -d '' item; do
  if /usr/bin/file -b "$item" | /usr/bin/grep -q '^Mach-O'; then
    /usr/bin/lipo -verify_arch arm64 "$item"
    /usr/bin/codesign --force --sign - "$item"
  fi
done < <(find "$app" -type f \( -name '*.node' -o -name '*.dylib' -o -path "$contents/Helpers/*" \) -print0)
/usr/bin/lipo -verify_arch arm64 "$contents/MacOS/OpenNote"
/usr/bin/codesign --force --sign - "$app"
/usr/bin/codesign --verify --deep --strict "$app"
ln -s /Applications "$stage/image/Applications"
/usr/bin/hdiutil create -quiet -srcfolder "$stage/image" -volname OpenNote -fs HFS+ -format UDZO "$stage/$artifact.dmg"
/usr/bin/hdiutil verify "$stage/$artifact.dmg"
(cd "$stage" && /usr/bin/shasum -a 256 "$artifact.dmg" > "$artifact.dmg.sha256")

out="$root/dist"
mkdir -p "$out"
cp "$root/scripts/macos/INSTALL.md" "$out/HUONG_DAN_OPENNOTE.md"
cp "$icon_png" "$out/"
cp "$source/public/opennote.svg" "$out/OpenNote-Icon.svg"
cp "$resources/OpenNote.icns" "$out/"
mv -f "$stage/$artifact.dmg" "$stage/$artifact.dmg.sha256" "$out/"
printf 'Bản cài: %s/%s.dmg\n' "$out" "$artifact"
