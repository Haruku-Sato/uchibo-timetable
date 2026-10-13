/* ===== 路線図（房総半島 西側の簡略図） =====
 * 座標は SVG の viewBox 単位。北が上。線の左（西）が東京湾、館山から先は下（南東）が太平洋。
 * 駅名は海側、区間の最終時刻は陸側に書く。文字の位置は mapLayout() で一度だけ計算し、描画・タップ判定・テストで共有する。
 */
import { STATIONS, BUS } from "../data/stations.mjs";
import { fmt } from "../model.mjs";
import { lastJourney } from "../search.mjs";

/* 駅の位置（STATIONS と同じ順） */
export const MAP_PTS = [
  [250, 30], [243, 58], [236, 86], [228, 114], [219, 142], [209, 170], [198, 198], // 千葉〜姉ヶ崎
  [178, 256], [170, 284], [163, 312], [156, 340],                                   // 長浦〜木更津
  [150, 368], [143, 396], [136, 424], [129, 452], [122, 480], [116, 508], [111, 536], // 君津〜浜金谷
  [107, 564], [104, 592], [102, 620], [101, 648], [103, 676], [110, 704],             // 保田〜館山
  [128, 738], [160, 762],                                                             // 九重・千倉
  [196, 752], [220, 732], [242, 712], [264, 692], [286, 672], [308, 652],             // 千歳〜安房鴨川
];
const VB = { x: 36, y: 0, w: 336, h: 800 };
export const MAP_VIEWBOX = `${VB.x} ${VB.y} ${VB.w} ${VB.h}`;
/* 大きめに描く駅（終点・乗換駅） */
const MAJOR = new Set(["千葉", "蘇我", "姉ヶ崎", "長浦", "木更津", "君津", "上総湊", "館山", "安房鴨川"].map(n => STATIONS.indexOf(n)));
/* 文字の大きさ（CSS の font-size と同じ値にすること） */
export const FONT = { st: 11, stMajor: 12, seg: 11, segBus: 11, sea: 12 };
/* 南端の折り返し（館山→九重→千倉→千歳）の内側は狭いので、区間の時刻の位置を個別に決める（区間の番号 → [x, y, anchor]） */
const SEG_POS = { 23: [123, 713, "start"], 24: [150, 728, "middle"], 25: [171, 748, "middle"], 26: [205, 731, "end"] };

/* 陸側の単位法線（進行方向 d=(dx,dy) に対し (dy,-dx)。千葉→安房鴨川の向きで右手が陸） */
function landNormal(dx, dy) { const l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; }
function stationNormal(i) {
  const a = MAP_PTS[Math.max(0, i - 1)], b = MAP_PTS[Math.min(MAP_PTS.length - 1, i + 1)];
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
    const [nx, ny] = stationNormal(i);
    const on = i === sel.a || i === sel.b;
    const x = p[0] - nx * 10, y = p[1] - ny * 10 + (ny > 0.45 ? 0 : ny < -0.45 ? 7 : 4);
    const anchor = anchorFor(-nx);
    const fs = MAJOR.has(i) ? FONT.stMajor : FONT.st;
    return { i, x: p[0], y: p[1], r: circleR(i, on), on, label: { x: r1(x), y: r1(y), anchor, box: textBox(x, y, anchor, STATIONS[i], fs) } };
  });
  const segOut = segs.map((g, i) => {
    let x, y, anchor;
    if (SEG_POS[i]) [x, y, anchor] = SEG_POS[i];
    else {
      const a = MAP_PTS[i], b = MAP_PTS[i + 1];
      const [nx, ny] = landNormal(b[0] - a[0], b[1] - a[1]);
      x = (a[0] + b[0]) / 2 + nx * 12; y = (a[1] + b[1]) / 2 + ny * 12 + 3.5; anchor = anchorFor(nx, 0.6);
    }
    return { ...g, x: r1(x), y: r1(y), anchor, box: textBox(x, y, anchor, g.text, g.bus ? FONT.segBus : FONT.seg) };
  });
  return { stations, segs: segOut };
}

/* 陸地の多角形：線を海側へ少しずらした海岸線＋東側を閉じる */
function landPath() {
  const coast = MAP_PTS.map((p, i) => { const [nx, ny] = stationNormal(i); return [p[0] - nx * 9, p[1] - ny * 9]; });
  const pts = [[262, -10], ...coast, [328, 632], [VB.x + VB.w + 10, 590], [VB.x + VB.w + 10, -10]];
  return "M" + pts.map(p => `${r1(p[0])},${r1(p[1])}`).join(" L") + " Z";
}

/**
 * 隣り合う駅の間ごとの最終（dir "down"＝千葉→安房鴨川の向き、"up"＝逆向き）。
 * 戻り値: 長さ 31 の配列。{text, bus?, none?}
 */
export function segmentLasts(net, dir, opts) {
  const out = [];
  for (let i = 0; i < STATIONS.length - 1; i++) {
    const [o, d] = dir === "down" ? [i, i + 1] : [i + 1, i];
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
  s += `<text class="sea-name" x="62" y="300">東京湾</text><text class="sea-name" x="222" y="790">太平洋</text>`;
  // 線路（姉ヶ崎〜長浦はバス＝点線）
  const line = (a, b) => "M" + P.slice(a, b + 1).map(p => p.join(",")).join(" L");
  s += `<path class="rail" d="${line(0, BUS.a)}"/><path class="rail" d="${line(BUS.b, P.length - 1)}"/>`;
  s += `<path class="bus-line" d="${line(BUS.a, BUS.b)}"/>`;
  // 選んだ区間（バス部分は黄色の点線のまま）
  if (sel.a != null && sel.b != null) {
    const lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
    if (lo < BUS.a) s += `<path class="sel-line" d="${line(lo, Math.min(hi, BUS.a))}"/>`;
    if (hi > BUS.b) s += `<path class="sel-line" d="${line(Math.max(lo, BUS.b), hi)}"/>`;
    if (lo <= BUS.a && hi >= BUS.b) s += `<path class="sel-line bus" d="${line(BUS.a, BUS.b)}"/>`;
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
