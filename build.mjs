/* src/ を結合して2つの出力を作る。 node build.mjs
 *   dist/index.html … claude.ai アーティファクト用（skeleton なしの HTML 1ファイル）
 *   site/           … PWA 版（GitHub Pages 用）：完全な HTML、manifest、Service Worker、アイコン
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const write = (p, s) => { fs.mkdirSync(path.dirname(path.join(ROOT, p)), { recursive: true }); fs.writeFileSync(path.join(ROOT, p), s); };

// 依存順。import 行を消し、export を外して1つのスクリプトにつなげる（トップレベルの名前は重複させないこと）
const MODULES = [
  "src/data/stations.mjs",
  "src/data/timetable.mjs",
  "src/data/extra.mjs",
  "src/model.mjs",
  "src/search.mjs",
  "src/ui/map.mjs",
  "src/ui/app.mjs",
];
export const ICONS = ["icon-192.png", "icon-512.png", "apple-touch-icon.png"];
export const APP = { name: "内房線 臨時ダイヤ 乗換検索", short: "内房線", bgLight: "#f3f6f8", bgDark: "#0f171c", accent: "#0098d1" };

export function bundleScript() {
  return MODULES.map(p => {
    const src = read(p)
      .replace(/^import\s[^;]*;\s*$/gm, "")
      .replace(/^export\s+(?=(const|let|function|class)\b)/gm, "");
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${p}: 変換できない import/export が残っている`);
    return `/* ---- ${p} ---- */\n${src.trim()}\n`;
  }).join("\n");
}

/* 本体（style・script を埋め込んだ HTML 断片）。dist と site で同じものを使う */
function body() {
  return read("src/ui/index.html")
    .replace("/*STYLE*/", () => "\n" + read("src/ui/style.css"))
    .replace("/*SCRIPT*/", () => "\n\"use strict\";\n" + bundleScript());
}

/* ビルドの日時：環境変数 BUILD_DATE か、git の最新コミットの日時（日本時間）。どちらもなければ今 */
function buildDate() {
  if (process.env.BUILD_DATE) return process.env.BUILD_DATE;
  let d;
  try { d = new Date(execSync("git log -1 --format=%cI", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim()); } catch (e) { d = new Date(); }
  if (Number.isNaN(d.getTime())) d = new Date();
  const j = new Date(d.getTime() + 9 * 3600e3).toISOString();
  return `${j.slice(0, 10)} ${j.slice(11, 16)}`;
}

/* claude.ai アーティファクト用：今までどおり（版の表示は付けない） */
export function build() {
  const html = body().replace("<!--APPVER-->", "");
  write("dist/index.html", html);
  return html;
}

/* PWA 版 */
export function buildSite() {
  const html0 = body();
  const sw0 = read("src/pwa/sw.js"), pwa0 = read("src/pwa/pwa.js");
  const icons = ICONS.map(f => fs.readFileSync(path.join(ROOT, "src/icons", f)));
  // 版＝中身のハッシュ（同じソースなら同じ版。変わったときだけ Service Worker のキャッシュが入れ替わる）
  const h = crypto.createHash("sha256");
  for (const x of [html0, sw0, pwa0, ...icons]) h.update(x);
  const version = h.digest("hex").slice(0, 10);
  const date = buildDate();

  const i = html0.indexOf('\n<div class="wrap">');
  if (i < 0) throw new Error("src/ui/index.html に <div class=\"wrap\"> が見つからない");
  const head = html0.slice(0, i).trim(), main = html0.slice(i).trim();
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${APP.short}">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="theme-color" content="${APP.bgLight}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${APP.bgDark}" media="(prefers-color-scheme: dark)">
<meta name="app-version" content="${version}">
<style>/* アーティファクトの skeleton が持っていた基本のスタイル */
:root{color-scheme:light;background:var(--bg);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>
${head}
</head>
<body>
${main.replace("<!--APPVER-->", `・アプリ ${date} 版（${version}）`)}
<script>
${pwa0.replaceAll("__VERSION__", version).trim()}
</script>
</body>
</html>
`;
  const manifest = {
    name: APP.name, short_name: APP.short, lang: "ja",
    start_url: "./", scope: "./", display: "standalone",
    background_color: APP.bgLight, theme_color: APP.accent,
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
  fs.rmSync(path.join(ROOT, "site"), { recursive: true, force: true });
  write("site/index.html", html);
  write("site/manifest.webmanifest", JSON.stringify(manifest, null, 2) + "\n");
  write("site/sw.js", sw0.replaceAll("__VERSION__", version));
  write("site/.nojekyll", "");
  ICONS.forEach((f, k) => { fs.mkdirSync(path.join(ROOT, "site/icons"), { recursive: true }); fs.writeFileSync(path.join(ROOT, "site/icons", f), icons[k]); });
  return { html, manifest, version, date };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = build();
  console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB`);
  const s = buildSite();
  console.log(`site/ 版 ${s.version}（${s.date}） index.html ${(s.html.length / 1024).toFixed(1)} KB`);
}
