/* src/ を自己完結した HTML 1ファイル（dist/index.html）に結合する。 node build.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");

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

export function bundleScript() {
  return MODULES.map(p => {
    const src = read(p)
      .replace(/^import\s[^;]*;\s*$/gm, "")
      .replace(/^export\s+(?=(const|let|function|class)\b)/gm, "");
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${p}: 変換できない import/export が残っている`);
    return `/* ---- ${p} ---- */\n${src.trim()}\n`;
  }).join("\n");
}

export function build() {
  const html = read("src/ui/index.html")
    .replace("/*STYLE*/", () => "\n" + read("src/ui/style.css"))
    .replace("/*SCRIPT*/", () => "\n\"use strict\";\n" + bundleScript());
  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "dist/index.html"), html);
  return html;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = build();
  console.log(`dist/index.html ${(html.length / 1024).toFixed(1)} KB`);
}
