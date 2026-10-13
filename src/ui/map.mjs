/* ===== 路線図（房総半島 西側の簡略図） =====
 * 座標は SVG の viewBox 単位。北が上。線の左（西）が東京湾、館山から先は下（南東）が太平洋。
 * 駅名は海側、区間の最終時刻は陸側に書く。
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
  [136, 728], [170, 746],                                                             // 九重・千倉
  [204, 734], [226, 716], [248, 698], [270, 680], [292, 662], [314, 644],             // 千歳〜安房鴨川
];
const VB = { x: 36, y: 0, w: 336, h: 770 };
export const MAP_VIEWBOX = `${VB.x} ${VB.y} ${VB.w} ${VB.h}`;
/* 大きめに描く駅（終点・乗換駅） */
const MAJOR = new Set(["千葉", "蘇我", "姉ヶ崎", "長浦", "木更津", "君津", "上総湊", "館山", "安房鴨川"].map(n => STATIONS.indexOf(n)));

/* 陸側の単位法線（進行方向 d=(dx,dy) に対し (dy,-dx)。千葉→安房鴨川の向きで右手が陸） */
function landNormal(dx, dy) { const l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; }
function stationNormal(i) {
  const a = MAP_PTS[Math.max(0, i - 1)], b = MAP_PTS[Math.min(MAP_PTS.length - 1, i + 1)];
  return landNormal(b[0] - a[0], b[1] - a[1]);
}
function anchorFor(nx, th = 0.45) { return nx > th ? "start" : nx < -th ? "end" : "middle"; }
/* 千倉の折り返しの内側で隣どうしの時刻がぶつからないよう、横にずらす（区間の番号 → [dx, dy]） */
const SEG_NUDGE = { 24: [-6, 0], 25: [6, 2] };
const r1 = x => Math.round(x * 10) / 10;

/* 陸地の多角形：線を海側へ少しずらした海岸線＋東側を閉じる */
function landPath() {
  const coast = MAP_PTS.map((p, i) => { const [nx, ny] = stationNormal(i); return [p[0] - nx * 9, p[1] - ny * 9]; });
  const pts = [[262, -10], ...coast, [332, 626], [VB.x + VB.w + 10, 585], [VB.x + VB.w + 10, -10]];
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
  let s = `<svg class="map" viewBox="${MAP_VIEWBOX}" role="img" aria-label="内房線 路線図（${dirLabel}の区間ごとの最終時刻）">`;
  s += `<rect class="sea" x="${VB.x}" y="${VB.y}" width="${VB.w}" height="${VB.h}"/>`;
  s += `<path class="land" d="${landPath()}"/>`;
  s += `<text class="sea-name" x="62" y="300">東京湾</text><text class="sea-name" x="250" y="758">太平洋</text>`;
  // 線路（姉ヶ崎〜長浦はバス＝点線）
  const line = (a, b) => "M" + P.slice(a, b + 1).map(p => p.join(",")).join(" L");
  s += `<path class="rail" d="${line(0, BUS.a)}"/><path class="rail" d="${line(BUS.b, P.length - 1)}"/>`;
  s += `<path class="bus-line" d="${line(BUS.a, BUS.b)}"/>`;
  // 選んだ区間
  if (sel.a != null && sel.b != null) {
    const lo = Math.min(sel.a, sel.b), hi = Math.max(sel.a, sel.b);
    s += `<path class="sel-line" d="${line(lo, hi)}"/>`;
  }
  // 区間の最終時刻（陸側）
  segs.forEach((g, i) => {
    const a = P[i], b = P[i + 1];
    const [nx, ny] = landNormal(b[0] - a[0], b[1] - a[1]);
    const [ddx, ddy] = SEG_NUDGE[i] || [0, 0];
    const x = (a[0] + b[0]) / 2 + nx * 12 + ddx, y = (a[1] + b[1]) / 2 + ny * 12 + 3.5 + ddy;
    s += `<text class="seg${g.bus ? " bus" : ""}${g.none ? " none" : ""}" x="${r1(x)}" y="${r1(y)}" text-anchor="${anchorFor(nx, 0.6)}">${g.text}</text>`;
  });
  // 駅（海側に駅名）
  P.forEach((p, i) => {
    const [nx, ny] = stationNormal(i);
    const on = i === sel.a || i === sel.b;
    const cls = `st${MAJOR.has(i) ? " major" : ""}${on ? " on" : ""}`;
    const lx = p[0] - nx * 10, ly = p[1] - ny * 10 + (ny > 0.45 ? 0 : ny < -0.45 ? 7 : 4);
    s += `<g class="${cls}" data-i="${i}" tabindex="0" role="button" aria-pressed="${on}" aria-label="${STATIONS[i]}">` +
      `<circle cx="${p[0]}" cy="${p[1]}" r="${on ? 8 : MAJOR.has(i) ? 6 : 4.5}"/>` +
      `<text x="${r1(lx)}" y="${r1(ly)}" text-anchor="${anchorFor(-nx)}">${STATIONS[i]}</text></g>`;
  });
  return s + "</svg>";
}

/* SVG 座標で最も近い駅（maxDist 以内）。なければ -1 */
export function nearestStation(x, y, maxDist = 24) {
  let best = -1, bd = maxDist;
  MAP_PTS.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
  return best;
}
