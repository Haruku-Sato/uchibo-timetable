/* ===== 路線図（房総半島 西側の簡略図） =====
 * 座標は SVG の viewBox 単位。北が上。線の左（西）が東京湾、館山から先は下（南東）が太平洋。
 * 駅名は海側、区間の最終時刻は陸側に書く。文字の位置は mapLayout() で一度だけ計算し、描画・タップ判定・テストで共有する。
 */
import { STATIONS, SI, BUS, UCHIBO_N } from "../data/stations.mjs";
import { fmt } from "../model.mjs";
import { lastJourney } from "../search.mjs";

/* 駅の位置（STATIONS と同じ順）。内房線は上に総武線・京葉線の余白を取るため TOP だけ下げてある */
const TOP = 70;
export const MAP_PTS = [
  [250, 30], [243, 58], [236, 86], [228, 114], [219, 142], [209, 170], [198, 198], // 千葉〜姉ヶ崎
  [178, 256], [170, 284], [163, 312], [156, 340],                                   // 長浦〜木更津
  [150, 368], [143, 396], [136, 424], [129, 452], [122, 480], [116, 508], [111, 536], // 君津〜浜金谷
  [107, 564], [104, 592], [102, 620], [101, 648], [103, 676], [110, 704],             // 保田〜館山
  [128, 738], [160, 762],                                                             // 九重・千倉
  [196, 752], [220, 732], [242, 712], [264, 692], [286, 672], [308, 652],             // 千歳〜安房鴨川
].map(([x, y]) => [x, y + TOP]).concat([
  [160, 40],  // 津田沼（千葉の北西）
  [170, 100], // 海浜幕張（京葉線。総武線の海側をほぼ平行に通る）
  [130, 76],  // 新習志野
]);
/* 区間：a = 東京寄り、b = 遠い側（"down" は a→b）。kind で線の描き方を変える */
export const MAP_SEGMENTS = [
  ...Array.from({ length: UCHIBO_N - 1 }, (_, i) => ({ a: i, b: i + 1, kind: i === BUS.a ? "bus" : "rail" })),
  { a: SI["津田沼"], b: SI["千葉"], kind: "sobu" },
  { a: SI["新習志野"], b: SI["海浜幕張"], kind: "keiyo" },
  { a: SI["海浜幕張"], b: SI["蘇我"], kind: "keiyo" },
];
/* 下り（東京から離れる向き）を決めるための順位。内房線は駅の番号、追加区間は千葉より手前 */
export function mapRank(i) { return i < UCHIBO_N ? i : { [SI["津田沼"]]: -3, [SI["新習志野"]]: -2, [SI["海浜幕張"]]: -1 }[i]; }
const VB = { x: 36, y: 0, w: 336, h: 800 + TOP };
/* 海の名前（文字の重なりチェックでも使う） */
export const SEA_LABELS = [{ text: "東京湾", x: 62, y: 300 + TOP }, { text: "太平洋", x: 222, y: 790 + TOP }];
export const MAP_VIEWBOX = `${VB.x} ${VB.y} ${VB.w} ${VB.h}`;
/* 大きめに描く駅（終点・乗換駅） */
const MAJOR = new Set(["千葉", "蘇我", "姉ヶ崎", "長浦", "木更津", "君津", "上総湊", "館山", "安房鴨川"].map(n => STATIONS.indexOf(n)));
/* 文字の大きさ（CSS の font-size と同じ値にすること） */
export const FONT = { st: 11, stMajor: 12, seg: 11, segBus: 11, sea: 12 };
/* 南端の折り返し（館山→九重→千倉→千歳）の内側は狭いので、区間の時刻の位置を個別に決める（区間の番号 → [x, y, anchor]） */
const SEG_POS = { 23: [123, 713 + TOP, "start"], 24: [150, 728 + TOP, "middle"], 25: [171, 748 + TOP, "middle"], 26: [205, 731 + TOP, "end"] };
/* 駅名の位置を個別に決める駅（駅 → [dx, dy, anchor]、丸の中心からの位置）。千葉・蘇我付近は枝線と重なるため */
const LABEL_POS = {
  [SI["千葉"]]: [10, 4, "start"], [SI["本千葉"]]: [10, 6, "start"], [SI["蘇我"]]: [-10, 12, "end"],
  [SI["津田沼"]]: [-10, 4, "end"], [SI["海浜幕張"]]: [-8, 17, "end"], [SI["新習志野"]]: [-10, 4, "end"],
};

/* 陸側の単位法線（進行方向 d=(dx,dy) に対し (dy,-dx)。千葉→安房鴨川の向きで右手が陸） */
function landNormal(dx, dy) { const l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; }
function stationNormal(i) {
  const a = MAP_PTS[Math.max(0, i - 1)], b = MAP_PTS[Math.min(UCHIBO_N - 1, i + 1)];
  return landNormal(b[0] - a[0], b[1] - a[1]);
}
function anchorFor(nx, th = 0.45) { return nx > th ? "start" : nx < -th ? "end" : "middle"; }
const r1 = x => Math.round(x * 10) / 10;

/* 文字の箱（概算）：全角は1文字＝フォントサイズ、半角は0.5 */
export function textBox(x, y, anchor, str, fs) {
  const w = [...str].reduce((q, ch) => q + (ch.charCodeAt(0) > 255 ? fs : fs * 0.5), 0);
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x0, x1: x0 + w, y0: y - fs * 0.85, y1: y + fs * 0.15 };
}
/* 駅の丸の半径（選択中は大きい） */
export function circleR(i, on) { return on ? 8 : MAJOR.has(i) ? 6 : 4.5; }

/**
 * 文字と丸の配置。segs は segmentLasts の結果（なくてもよい）。
 * 戻り値: {stations:[{i, x, y, r, label:{x, y, anchor, box}}], segs:[{x, y, anchor, box, text, bus, none}]}
 */
export function mapLayout(segs = [], sel = {}) {
  const stations = MAP_PTS.map((p, i) => {
    const on = i === sel.a || i === sel.b;
    let x, y, anchor;
    if (LABEL_POS[i]) { const [dx, dy, an] = LABEL_POS[i]; x = p[0] + dx; y = p[1] + dy; anchor = an; }
    else {
      const [nx, ny] = stationNormal(i);
      x = p[0] - nx * 10; y = p[1] - ny * 10 + (ny > 0.45 ? 0 : ny < -0.45 ? 7 : 4); anchor = anchorFor(-nx);
    }
    const fs = MAJOR.has(i) ? FONT.stMajor : FONT.st;
    return { i, x: p[0], y: p[1], r: circleR(i, on), on, label: { x: r1(x), y: r1(y), anchor, box: textBox(x, y, anchor, STATIONS[i], fs) } };
  });
  const segOut = segs.map((g, i) => {
    let x, y, anchor;
    const sg = MAP_SEGMENTS[i];
    if (SEG_POS[i]) [x, y, anchor] = SEG_POS[i];
    else {
      const a = MAP_PTS[sg.a], b = MAP_PTS[sg.b];
      let [nx, ny] = landNormal(b[0] - a[0], b[1] - a[1]);
      const off = sg.kind === "sobu" || sg.kind === "keiyo" ? 15 : 12; // 枝線は斜めなので少し離す
      if (sg.kind === "keiyo") { nx = -nx; ny = -ny; } // 京葉線は海側に書く（陸側は内房線の駅名と重なるため）
      x = (a[0] + b[0]) / 2 + nx * off; y = (a[1] + b[1]) / 2 + ny * off + 3.5; anchor = anchorFor(nx, 0.6);
    }
    return { ...g, x: r1(x), y: r1(y), anchor, box: textBox(x, y, anchor, g.text, g.bus ? FONT.segBus : FONT.seg) };
  });
  return { stations, segs: segOut };
}

/* 陸地の多角形：線を海側へ少しずらした海岸線＋東側を閉じる。
 * 千葉付近は京葉線（新習志野→海浜幕張→蘇我）が海沿いなので、そこから内房線の蘇我以南へつなぐ */
function landPath() {
  const keiyo = [SI["新習志野"], SI["海浜幕張"]].map(i => {
    const p = MAP_PTS[i], q = MAP_PTS[SI["蘇我"]], o = MAP_PTS[SI["新習志野"]];
    const [nx, ny] = landNormal(q[0] - o[0], q[1] - o[1]);
    return [p[0] - nx * 9, p[1] - ny * 9];
  });
  const coast = MAP_PTS.slice(SI["蘇我"], UCHIBO_N).map((p, k) => { const [nx, ny] = stationNormal(k + SI["蘇我"]); return [p[0] - nx * 9, p[1] - ny * 9]; });
  const pts = [[VB.x - 10, -10], [VB.x - 10, 58], ...keiyo, ...coast, [328, 632 + TOP], [VB.x + VB.w + 10, 590 + TOP], [VB.x + VB.w + 10, -10]];
  return "M" + pts.map(p => `${r1(p[0])},${r1(p[1])}`).join(" L") + " Z";
}

/**
 * 隣り合う駅の間ごとの最終（dir "down"＝千葉→安房鴨川の向き、"up"＝逆向き）。
 * 戻り値: MAP_SEGMENTS と同じ順・同じ長さの配列。{text, bus?, none?}
 */
export function segmentLasts(net, dir, opts) {
  const out = [];
  for (const sg of MAP_SEGMENTS) {
    const [o, d] = dir === "down" ? [sg.a, sg.b] : [sg.b, sg.a];
    const j = lastJourney(net, o, d, opts);
    if (!j) out.push({ text: "—", none: true });
    else if (j.busOnly) out.push({ text: opts.busLast == null ? "バス" : `バス〜${fmt(opts.busLast)}`, bus: true });
    else out.push({ text: fmt(j.dep) });
  }
  return out;
}

/**
 * 路線図の SVG 文字列。sel: {a, b}（選んだ駅。b は null 可）、segs: segmentLasts の結果、dirLabel: "下り"|"上り"
 */
export function mapSvg({ sel = {}, segs = [], dirLabel = "" } = {}) {
  const P = MAP_PTS;
  const L = mapLayout(segs, sel);
  let s = `<svg class="map" viewBox="${MAP_VIEWBOX}" role="img" aria-label="内房線 路線図（${dirLabel}の区間ごとの最終時刻）">`;
  s += `<rect class="sea" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}"/>`;
  s += `<path class="land" d="${landPath()}"/>`;
  for (const t of SEA_LABELS) s += `<text class="sea-name" x="${t.x}" y="${t.y}">${t.text}</text>`;
  // 線路（内房線は1本のパス、姉ヶ崎〜長浦はバス＝点線、総武線・京葉線は細い別の色）
  const line = (a, b) => "M" + P.slice(a, b + 1).map(p => p.join(",")).join(" L");
  const seg = sg => `M${P[sg.a].join(",")} L${P[sg.b].join(",")}`;
  s += `<path class="rail" d="${line(0, BUS.a)}"/><path class="rail" d="${line(BUS.b, UCHIBO_N - 1)}"/>`;
  s += `<path class="bus-line" d="${line(BUS.a, BUS.b)}"/>`;
  for (const sg of MAP_SEGMENTS) if (sg.kind === "sobu" || sg.kind === "keiyo") s += `<path class="branch ${sg.kind}" d="${seg(sg)}"/>`;
  // 選んだ区間（駅と駅を結ぶ区間の並び。バス部分は黄色の点線のまま）
  if (sel.a != null && sel.b != null) {
    for (const sg of mapPath(sel.a, sel.b)) s += `<path class="sel-line${sg.kind === "bus" ? " bus" : ""}" d="${seg(sg)}"/>`;
  }
  // 区間の最終時刻（陸側）
  for (const g of L.segs) {
    s += `<text class="seg${g.bus ? " bus" : ""}${g.none ? " none" : ""}" x="${g.x}" y="${g.y}" text-anchor="${g.anchor}">${g.text}</text>`;
  }
  // 駅（海側に駅名）
  for (const st of L.stations) {
    const cls = `st${MAJOR.has(st.i) ? " major" : ""}${st.on ? " on" : ""}`;
    s += `<g class="${cls}" data-i="${st.i}" tabindex="0" role="button" aria-pressed="${st.on}" aria-label="${STATIONS[st.i]}">` +
      `<circle cx="${st.x}" cy="${st.y}" r="${st.r}"/>` +
      `<text x="${st.label.x}" y="${st.label.y}" text-anchor="${st.label.anchor}">${STATIONS[st.i]}</text></g>`;
  }
  return s + "</svg>";
}

/* 路線図の上で駅 a から駅 b までたどる区間の並び（区間は木構造なので経路は1つ） */
export function mapPath(a, b) {
  const prev = new Map([[a, null]]), queue = [a];
  while (queue.length) {
    const u = queue.shift();
    if (u === b) break;
    for (const sg of MAP_SEGMENTS) {
      const v = sg.a === u ? sg.b : sg.b === u ? sg.a : -1;
      if (v >= 0 && !prev.has(v)) { prev.set(v, { u, sg }); queue.push(v); }
    }
  }
  const out = [];
  for (let v = b; prev.get(v); v = prev.get(v).u) out.unshift(prev.get(v).sg);
  return out;
}

/* 点と箱の距離（中なら 0） */
function boxDist(x, y, b) { return Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.y0 - y, 0, y - b.y1)); }

/**
 * タップした位置（SVG 座標）の駅。駅の丸から maxDist 以内か、駅名の文字（＋pad）の上なら候補にし、
 * いちばん近いものを返す。駅名は丸から離れているので、文字の上をタップしても選べるようにする。なければ -1。
 */
export function nearestStation(x, y, maxDist = 24, pad = 6) {
  let best = -1, bd = Infinity;
  for (const st of mapLayout().stations) {
    const dc = Math.hypot(st.x - x, st.y - y), dl = boxDist(x, y, st.label.box);
    if (dc > maxDist && dl > pad) continue;
    const d = Math.min(dc, dl);
    if (d < bd) { bd = d; best = st.i; }
  }
  return best;
}
