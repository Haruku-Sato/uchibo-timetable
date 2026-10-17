#!/bin/sh
# src/icons/icon.svg から PWA のアイコン（PNG）を作る。macOS 標準の qlmanage（Quick Look）と sips を使う。
# アイコンを変えたときだけ手で実行し、できた PNG をコミットする（GitHub Actions ではこのスクリプトは使わない）。
set -eu
cd "$(dirname "$0")/../src/icons"
tmp=$(mktemp -d)
qlmanage -t -s 512 -o "$tmp" icon.svg >/dev/null 2>&1
cp "$tmp/icon.svg.png" icon-512.png
sips -z 192 192 icon-512.png --out icon-192.png >/dev/null
sips -z 180 180 icon-512.png --out apple-touch-icon.png >/dev/null
rm -rf "$tmp"
sips -g pixelWidth -g pixelHeight icon-512.png icon-192.png apple-touch-icon.png | grep -v "^/"
