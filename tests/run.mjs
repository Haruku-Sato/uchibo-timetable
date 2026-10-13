/* node tests/run.mjs */
import { buildModel, checkTrains, fmt, tm } from "../src/model.mjs";
import { STATIONS, SI } from "../src/data/stations.mjs";
import { buildNetwork, earliest, journeys, lastJourney, annotate } from "../src/search.mjs";
import { build, bundleScript } from "../build.mjs";
import { segmentLasts, mapSvg, mapLayout, nearestStation, textBox, FONT, MAP_PTS, MAP_VIEWBOX } from "../src/ui/map.mjs";
import vm from "node:vm";

let failed = 0, passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).replace(/\n/g, "\n     ")}`); }
}
function eq(a, b, msg = "") { if (a !== b) throw new Error(`${msg} 期待値 ${b} / 実際 ${a}`); }
function noProblems(list) { if (list.length) throw new Error(list.join("\n")); }

const model = buildModel();
const { trains, links } = model;
const find = (table, col) => trains.filter(t => t.table === table && t.col === col);
const stopAt = (t, name) => t.stops.find(s => s.s === SI[name]);

/* ===== データの健全性 ===== */
test("データの書式（セル数・空欄・＝・接続の特定）", () => noProblems(model.problems));
test("各列の時刻が駅順に単調増加（0時跨ぎ考慮）", () => noProblems(checkTrains(trains)));

test("列車の本数", () => {
  const n = id => trains.filter(t => t.table === id).length;
  eq(n("down-chiba-anegasaki"), 51, "下り 千葉→姉ヶ崎");
  eq(n("up-anegasaki-chiba"), 49, "上り 姉ヶ崎→千葉");
  eq(n("down-nagaura-kisarazu"), 31, "下り 長浦→木更津");
  eq(n("up-kisarazu-nagaura"), 31, "上り 木更津→長浦");
  eq(n("down-kisarazu-awakamogawa"), 23, "下り 木更津→安房鴨川"); // 21列＋1-08が2本に分かれる
  eq(n("up-awakamogawa-kisarazu"), 22, "上り 安房鴨川→木更津");   // 20列＋1-09, 1-11が2本ずつ
});

test("0時台は24時以降", () => {
  eq(tm("0:10"), 24 * 60 + 10);
  const t = find("down-kisarazu-awakamogawa", "2-18")[0];
  eq(stopAt(t, "館山").arr, tm("0:14"));
});

/* ===== 「＝」と途中駅始発 ===== */
test("下り 1-08：上総湊止まりと館山始発の2本に分かれる", () => {
  const [a, b] = find("down-kisarazu-awakamogawa", "1-08");
  eq(STATIONS[a.stops.at(-1).s], "上総湊"); eq(fmt(a.stops.at(-1).arr), "8:58");
  eq(STATIONS[b.stops[0].s], "館山"); eq(fmt(b.stops[0].dep), "9:36");
  eq(STATIONS[b.stops.at(-1).s], "安房鴨川"); eq(fmt(b.stops.at(-1).arr), "10:21");
});
test("上り 君津7:18発・8:36発は木更津へ行かない", () => {
  for (const tr of trains.filter(t => t.table === "up-awakamogawa-kisarazu")) {
    const k = stopAt(tr, "君津");
    if (k && (fmt(k.dep) === "7:18" || fmt(k.dep) === "8:36")) {
      eq(STATIONS[tr.stops.at(-1).s], "君津", `君津${fmt(k.dep)}発の終点`);
    }
  }
});
test("上り 1-09, 1-11：館山止まりと上総湊始発に分かれる", () => {
  const [a, b] = find("up-awakamogawa-kisarazu", "1-09");
  eq(STATIONS[a.stops.at(-1).s], "館山"); eq(STATIONS[b.stops[0].s], "上総湊"); eq(STATIONS[b.stops.at(-1).s], "君津");
  const [c, d] = find("up-awakamogawa-kisarazu", "1-11");
  eq(STATIONS[c.stops.at(-1).s], "館山"); eq(STATIONS[d.stops[0].s], "上総湊"); eq(STATIONS[d.stops.at(-1).s], "木更津");
});

/* ===== 平日のみ・君津着の推定・矢印 ===== */
test("平日のみ：保田6:44発のみ", () => {
  const w = trains.filter(t => t.weekdayOnly);
  eq(w.length, 1); eq(STATIONS[w[0].stops[0].s], "保田"); eq(fmt(w[0].stops[0].dep), "6:44");
});
/* ===== 途中駅の着時刻の推定（着 = min(発, 前駅の発 + 区間の最短所要)） ===== */
test("推定着：上り 1-16 の館山着が 10:38 より前（九重10:14発）", () => {
  const t = find("up-awakamogawa-kisarazu", "1-16")[0];
  const s = stopAt(t, "館山");
  if (!(s.arr < tm("10:38"))) throw new Error(`館山着 ${fmt(s.arr)}`);
  eq(s.arrEst, true); eq(fmt(s.dep), "10:38");
});
test("推定着：上り 2-03 の君津着が 15:02 より前、下り 1-01 の館山着が 6:32 より前", () => {
  const a = stopAt(find("up-awakamogawa-kisarazu", "2-03")[0], "君津");
  if (!(a.arr < tm("15:02"))) throw new Error(`君津着 ${fmt(a.arr)}`);
  const b = stopAt(find("down-kisarazu-awakamogawa", "1-01")[0], "館山");
  if (!(b.arr < tm("6:32"))) throw new Error(`館山着 ${fmt(b.arr)}`);
});
test("推定着：下り 木更津15:17発 の君津着は 15:44 より前（推定）、発は15:44", () => {
  const t = trains.find(t => t.table === "down-kisarazu-awakamogawa" && fmt(t.stops[0].dep) === "15:17");
  const k = stopAt(t, "君津");
  if (!(k.arr <= tm("15:24"))) throw new Error(`君津着 ${fmt(k.arr)}`);
  eq(fmt(k.dep), "15:44"); eq(k.arrEst, true);
});
test("推定着：時刻表に「着」がある駅（終点・蘇我）は推定しない", () => {
  for (const t of trains) for (const s of t.stops) if (s.arrGiven && s.arrEst) throw new Error(`${t.table} ${t.col} ${STATIONS[s.s]}`);
});
test("推定着：千葉〜姉ヶ崎（v1 で確認済み）は変わらない", () => {
  const n = trains.filter(t => t.table.includes("chiba") && t.stops.some(s => s.arrEst)).length;
  eq(n, 0);
});
test("矢印の接続が5本とも列車に結びつく", () => {
  eq(links.length, 5);
  const desc = links.map(l => `${STATIONS[l.at]} ${fmt(l.arr)}→${fmt(l.dep)}`).sort().join(", ");
  eq(desc, "上総湊 8:08→8:09, 館山 6:59→7:10, 館山 7:05→7:16, 館山 7:58→8:01, 館山 8:00→8:01");
});

/* ===== 検索（バス25分・乗換余裕2分・平日） ===== */
const net = buildNetwork(model);
const O = { margin: 2, busMin: 25 };
const legStr = j => j.legs.map(l => `${STATIONS[l.from]}${fmt(l.dep)}→${STATIONS[l.to]}${fmt(l.arr)}${l.type === "bus" ? "(バス)" : ""}`).join(" / ");

test("君津→千葉 9:42着まで：最終は君津8:07発（千葉9:26着）、その前は7:44発（9:10着）", () => {
  const list = journeys(net, SI["君津"], SI["千葉"], "arr", tm("9:42"), O);
  eq(fmt(list[0].dep), "8:07", legStr(list[0])); eq(fmt(list[0].arr), "9:26");
  eq(fmt(list[1].dep), "7:44", legStr(list[1])); eq(fmt(list[1].arr), "9:10");
});
test("千葉→君津の最終：千葉20:29発（姉ヶ崎20:54→バス→長浦21:33発→木更津21:45着/21:50発→君津）", () => {
  const j = lastJourney(net, SI["千葉"], SI["君津"], O);
  eq(fmt(j.dep), "20:29", legStr(j));
  const [a, bus, b, c] = j.legs;
  eq(j.legs.length, 4, legStr(j));
  eq(fmt(a.arr), "20:54"); eq(bus.type, "bus"); eq(fmt(bus.arr), "21:19");
  eq(fmt(b.dep), "21:33"); eq(fmt(b.arr), "21:45"); eq(fmt(c.dep), "21:50");
  if (!(j.arr >= tm("21:55") && j.arr <= tm("21:58"))) throw new Error(`君津着 ${fmt(j.arr)}`);
});
test("木更津→君津（下り）の最終：木更津23:14発", () => {
  eq(fmt(lastJourney(net, SI["木更津"], SI["君津"], O).dep), "23:14");
});
test("長浦→木更津の最終：長浦21:33発（木更津21:45着）", () => {
  const j = lastJourney(net, SI["長浦"], SI["木更津"], O);
  eq(fmt(j.dep), "21:33"); eq(fmt(j.arr), "21:45");
});
test("バス40分：千葉→君津の最終が千葉20:29発より早くなる", () => {
  const j = lastJourney(net, SI["千葉"], SI["君津"], { margin: 2, busMin: 40 });
  if (!(j.dep < tm("20:29"))) throw new Error(`最終 ${fmt(j.dep)}発`);
});
test("矢印：館山8:00着→8:01発に、乗換余裕5分でも乗り継げる", () => {
  const j = earliest(net, SI["木更津"], SI["安房鴨川"], tm("6:40"), { margin: 5, busMin: 25 });
  eq(fmt(j.arr), "8:48", legStr(j));
  const k = j.legs.findIndex(l => l.type === "train" && l.from === SI["館山"]);
  eq(fmt(j.legs[k - 1].arr), "8:00", legStr(j)); eq(fmt(j.legs[k].dep), "8:01"); eq(j.legs[k].linked, true);
});
test("矢印：上り 館山7:58→8:01（乗換余裕5分）", () => {
  const j = earliest(net, SI["安房鴨川"], SI["君津"], tm("7:18"), { margin: 5, busMin: 25 });
  eq(fmt(j.dep), "7:18", legStr(j)); eq(fmt(j.legs[0].arr), "7:58");
  eq(j.legs[1].linked, true); eq(fmt(j.legs[1].dep), "8:01");
  eq(fmt(j.arr), "8:56", legStr(j)); // 君津は青堀8:53発＋最短所要の推定着（発は9:03）
  eq(j.legs[1].arrEst, true);
});
test("矢印：上総湊8:08→8:09（← の接続、乗換余裕2分）", () => {
  const j = earliest(net, SI["木更津"], SI["館山"], tm("7:41"), O);
  eq(fmt(j.dep), "7:41", legStr(j)); eq(fmt(j.arr), "8:43");
  eq(j.legs[1].from, SI["上総湊"]); eq(j.legs[1].linked, true);
});
test("矢印でない乗換には余裕がかかる（木更津21:45着→21:50発は余裕5分なら可、8分なら不可）", () => {
  const ok5 = earliest(net, SI["長浦"], SI["君津"], tm("21:30"), { margin: 5, busMin: 25 });
  eq(fmt(ok5.legs[1].dep), "21:50", legStr(ok5));
  const ng8 = earliest(net, SI["長浦"], SI["君津"], tm("21:30"), { margin: 8, busMin: 25 });
  eq(fmt(ng8.legs[1].dep), "23:14", legStr(ng8));
});
test("同じ到着なら遅く出る経路を出す（那古船形→安房鴨川は7:56発、折り返し経路は出さない）", () => {
  const list = journeys(net, SI["那古船形"], SI["安房鴨川"], "dep", tm("7:02"), { margin: 5, busMin: 25 });
  eq(fmt(list[0].dep), "7:56", legStr(list[0])); eq(fmt(list[0].arr), "8:48");
  eq(list[0].legs.length, 2); eq(list[0].legs[1].linked, true);
});
test("平日のみ：土休日は保田6:44発に乗れない", () => {
  const wk = earliest(net, SI["保田"], SI["富浦"], tm("6:30"), O);
  eq(fmt(wk.dep), "6:44"); eq(fmt(wk.arr), "6:58"); eq(wk.legs[0].weekdayOnly, true);
  const hol = earliest(buildNetwork(model, { dayType: "holiday" }), SI["保田"], SI["富浦"], tm("6:30"), O);
  eq(fmt(hol.arr), "7:53", legStr(hol));
  if (hol.legs.some(l => l.weekdayOnly)) throw new Error(legStr(hol));
});
test("姉ヶ崎↔長浦はバスのみ", () => {
  eq(lastJourney(net, SI["姉ヶ崎"], SI["長浦"], O).busOnly, true);
  const j = earliest(net, SI["姉ヶ崎"], SI["長浦"], tm("10:00"), O);
  eq(j.legs.length, 1); eq(j.legs[0].type, "bus"); eq(fmt(j.arr), "10:25");
});
test("千葉→安房鴨川：経路が見つかり、駅と時刻がつながっている", () => {
  const list = journeys(net, SI["千葉"], SI["安房鴨川"], "dep", tm("6:00"), O);
  if (!list.length) throw new Error("経路なし");
  for (const j of list) j.legs.forEach((l, k) => {
    if (k && (l.from !== j.legs[k - 1].to || l.dep < j.legs[k - 1].arr)) throw new Error(legStr(j));
  });
});

/* ===== バスの運行時間（FEEDBACK 段階2-1） ===== */
test("運行時間 指定なし：千葉→長浦の最終は0:10発（バス0:31発）、未確認の注意が出る", () => {
  const j = lastJourney(net, SI["千葉"], SI["長浦"], O);
  eq(fmt(j.dep), "0:10", legStr(j));
  eq(annotate(j, O).busUnsure, true);
});
test("バス最終21:30：千葉→長浦の最終は姉ヶ崎21:30以前に着く列車", () => {
  const o = { ...O, busLast: tm("21:30") };
  const j = lastJourney(net, SI["千葉"], SI["長浦"], o);
  const bus = j.legs.find(l => l.type === "bus");
  if (!(j.legs[0].arr <= tm("21:30") && bus.dep <= tm("21:30"))) throw new Error(legStr(j));
  eq(fmt(j.dep), "21:04", legStr(j));
  eq(annotate(j, o).busUnsure, false);
});
test("バス始発6:00：長浦→千葉の始発は6:00以降のバス", () => {
  const o = { ...O, busFirst: tm("6:00") };
  const j = earliest(net, SI["長浦"], SI["千葉"], tm("4:30"), o);
  eq(fmt(j.legs[0].dep), "6:00", legStr(j)); eq(fmt(j.legs[1].dep), "6:44");
  eq(annotate(j, O).busUnsure, false); // 6:00 は「6:00より前」ではない
  const k = earliest(net, SI["長浦"], SI["千葉"], tm("4:30"), O);
  eq(fmt(k.legs[0].dep), "4:30"); eq(annotate(k, O).busUnsure, true);
});
test("バス最終は24時以降も扱える（0:31なら千葉0:10発、0:30なら23:50発）", () => {
  eq(fmt(lastJourney(net, SI["千葉"], SI["長浦"], { ...O, busLast: tm("0:31") }).dep), "0:10");
  eq(fmt(lastJourney(net, SI["千葉"], SI["長浦"], { ...O, busLast: tm("0:30") }).dep), "23:50");
});

/* ===== 画面の注意点（annotate） ===== */
test("出発がバスになる最終（姉ヶ崎→木更津）：busStart、出発は木更津行最終に間に合う時刻", () => {
  const j = lastJourney(net, SI["姉ヶ崎"], SI["木更津"], O);
  const a = annotate(j, O);
  eq(a.busStart, true); eq(fmt(j.dep), "21:06", legStr(j)); // 21:06+25=21:31, +2 → 長浦21:33発
  eq(a.tight, false, "バス直後の乗換はギリギリにしない"); eq(a.transfers[0].wait, 2);
});
test("バスが途中にある経路では、バス直後の乗換2分はギリギリのまま", () => {
  const j = earliest(net, SI["千葉"], SI["木更津"], tm("20:20"), O); // 姉ヶ崎20:54→バス21:19→長浦21:33（14分）
  eq(annotate(j, O).transfers[1].tight, false);
  const fake = { dep: 0, arr: 0, legs: [{ type: "train", dep: 0, arr: 10 }, { type: "bus", dep: 10, arr: 35 }, { type: "train", dep: 37, arr: 50 }] };
  eq(annotate(fake, O).transfers[1].tight, true);
});
test("推定着からの乗換に est が付く", () => {
  // 実データ：大貫14:33発（上り 2-03）→ 君津は推定着 14:45頃
  const k = earliest(net, SI["大貫"], SI["君津"], tm("14:30"), O);
  eq(fmt(k.arr), "14:45", legStr(k)); eq(annotate(k, O).arrEst, true);
  // 推定着 → 別の列車 の乗換
  const fake = { dep: 10, arr: 30, legs: [{ type: "train", dep: 10, arr: 20, arrEst: true }, { type: "train", dep: 21, arr: 30 }] };
  const fa = annotate(fake, O);
  eq(fa.estTransfer, true); eq(fa.transfers[0].est, true); eq(fa.transfers[0].tight, true);
});
test("矢印の接続は待ちが短くてもギリギリ扱いにしない", () => {
  const j = earliest(net, SI["木更津"], SI["安房鴨川"], tm("6:40"), { margin: 5, busMin: 25 });
  const a = annotate(j, O);
  eq(a.tight, false); eq(a.transfers.some(t => t.linked && t.wait === 1), true);
});

/* ===== 路線図 ===== */
test("路線図：駅の座標が32駅ぶん、隣の駅と近すぎない", () => {
  eq(MAP_PTS.length, STATIONS.length);
  for (let i = 1; i < MAP_PTS.length; i++) {
    const d = Math.hypot(MAP_PTS[i][0] - MAP_PTS[i - 1][0], MAP_PTS[i][1] - MAP_PTS[i - 1][1]);
    if (d < 26) throw new Error(`${STATIONS[i - 1]}〜${STATIONS[i]} の間隔 ${d.toFixed(1)}`);
  }
  for (let i = 0; i < MAP_PTS.length; i++) eq(nearestStation(MAP_PTS[i][0] + 3, MAP_PTS[i][1] - 3), i, STATIONS[i]);
  eq(nearestStation(40, 400), -1);
});
test("路線図：区間ごとの最終（下り 木更津→君津 23:14、上り 君津→木更津 22:59、姉ヶ崎〜長浦はバス）", () => {
  const dn = segmentLasts(net, "down", O), up = segmentLasts(net, "up", O);
  eq(dn.length, 31); eq(up.length, 31);
  eq(dn[SI["木更津"]].text, "23:14"); eq(up[SI["木更津"]].text, "22:59");
  eq(dn[SI["姉ヶ崎"]].bus, true); eq(up[SI["姉ヶ崎"]].text, "バス");
  eq(segmentLasts(net, "up", { ...O, busLast: tm("21:30") })[SI["姉ヶ崎"]].text, "バス〜21:30");
  eq(dn[SI["長浦"]].text, "21:33"); eq(dn[0].text, "0:10");
  for (const g of [...dn, ...up]) if (!/^(\d{1,2}:\d{2}|バス.*)$/.test(g.text)) throw new Error(g.text);
});
test("路線図：SVG に32駅・点線のバス区間・選択区間・31個の時刻が入る", () => {
  const svg = mapSvg({ sel: { a: 0, b: SI["君津"] }, segs: segmentLasts(net, "down", O), dirLabel: "下り" });
  eq((svg.match(/<g class="st/g) || []).length, 32);
  eq((svg.match(/class="bus-line"/g) || []).length, 1);
  eq((svg.match(/class="sel-line( bus)?"/g) || []).length, 3); // 千葉〜姉ヶ崎、バス、長浦〜君津
  eq((svg.match(/<text class="seg/g) || []).length, 31);
  eq((svg.match(/aria-pressed="true"/g) || []).length, 2);
  if (/NaN|undefined/.test(svg)) throw new Error("NaN/undefined を含む");
});

test("路線図：文字どうし・文字と駅の丸・文字と線路が重ならず、枠からはみ出さない（文字幅は概算）", () => {
  const [vx, vy, vw, vh] = MAP_VIEWBOX.split(" ").map(Number);
  const GAP = 1.5; // 箱どうしの最小のすき間
  const probs = new Set();
  const hit = (a, b) => a.x0 < b.x1 + GAP && b.x0 < a.x1 + GAP && a.y0 < b.y1 + GAP && b.y0 < a.y1 + GAP;
  const boxCircle = (b, c) => Math.hypot(Math.max(b.x0 - c.x, 0, c.x - b.x1), Math.max(b.y0 - c.y, 0, c.y - b.y1)) < c.r + 1.5 + GAP;
  const sels = [{}, { a: SI["館山"], b: SI["千歳"] }, { a: SI["九重"], b: SI["千倉"] }, { a: 0, b: SI["安房鴨川"] }];
  for (const o of [O, { ...O, busLast: tm("21:30") }]) for (const dir of ["down", "up"]) for (const dayType of ["weekday", "holiday"]) for (const sel of sels) {
    const L = mapLayout(segmentLasts(buildNetwork(model, { dayType }), dir, o), sel);
    const texts = [
      ...L.stations.map(st => ({ str: STATIONS[st.i], box: st.label.box })),
      ...L.segs.map(g => ({ str: g.text, box: g.box })),
      { str: "東京湾", box: textBox(62, 300, "start", "東京湾", FONT.sea + 3) }, // letter-spacing ぶん広めに
      { str: "太平洋", box: textBox(222, 790, "start", "太平洋", FONT.sea + 3) },
    ];
    texts.forEach((a, i) => texts.slice(i + 1).forEach(b => { if (hit(a.box, b.box)) probs.add(`${dir} 文字の重なり ${a.str} / ${b.str}`); }));
    for (const t of texts) {
      const b = t.box;
      if (b.x0 < vx || b.x1 > vx + vw || b.y0 < vy + 2 || b.y1 > vy + vh - 6) probs.add(`${dir} 枠に近い ${t.str}`);
      for (const c of L.stations) if (boxCircle(b, c) && t.str !== STATIONS[c.i]) probs.add(`${dir} 丸と重なる ${t.str} / ${STATIONS[c.i]}の丸`);
      outer: for (let i = 0; i < MAP_PTS.length - 1; i++) for (let k = 0; k <= 20; k++) {
        const x = MAP_PTS[i][0] + (MAP_PTS[i + 1][0] - MAP_PTS[i][0]) * k / 20, y = MAP_PTS[i][1] + (MAP_PTS[i + 1][1] - MAP_PTS[i][1]) * k / 20;
        if (x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2) { probs.add(`${dir} 線と重なる ${t.str}`); break outer; }
      }
    }
  }
  noProblems([...probs]);
});
test("路線図：駅名の文字の上をタップしても、その駅が選ばれる", () => {
  for (const st of mapLayout().stations) {
    const b = st.label.box;
    eq(nearestStation((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2), st.i, `${STATIONS[st.i]}の駅名の中央`);
    eq(nearestStation(st.label.anchor === "end" ? b.x0 + 2 : b.x1 - 2, (b.y0 + b.y1) / 2), st.i, `${STATIONS[st.i]}の駅名の端`);
  }
});
test("路線図：選んだ区間がバスを含むとき、バス部分は点線（sel-line bus）で描く", () => {
  const svg = mapSvg({ sel: { a: 0, b: SI["君津"] }, segs: [] });
  eq((svg.match(/class="sel-line bus"/g) || []).length, 1);
  eq((svg.match(/class="sel-line"/g) || []).length, 2);
  eq((mapSvg({ sel: { a: SI["長浦"], b: SI["君津"] } }).match(/class="sel-line bus"/g) || []).length, 0);
});

/* ===== ビルド（dist/index.html） ===== */
test("ビルド：1ファイル・<title>と<style>が先頭・禁止タグなし・外部は Google Fonts のみ", () => {
  const html = build();
  if (!/^<title>[^<]+<\/title>\s*<style>/.test(html)) throw new Error("先頭が <title><style> でない");
  for (const bad of [/<!doctype/i, /<html[\s>]/i, /<head[\s>]/i, /<body[\s>]/i, /\balert\(/, /\bconfirm\(/, /window\.print/, /\bfetch\(/]) {
    if (bad.test(html)) throw new Error(`使えないもの: ${bad}`);
  }
  const ext = [...html.matchAll(/(?:href|src)="(https?:[^"]+)"/g)].map(m => m[1]).filter(u => !u.startsWith("https://fonts.googleapis.com/"));
  if (ext.length) throw new Error(ext.join(", "));
});
test("ビルド：スクリプトが構文エラーなし、偽の DOM 上で動く（localStorage なしでも）", () => {
  const code = bundleScript();
  new vm.Script(code);
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, {
      id, value: "", innerHTML: "", textContent: "", children: [], attrs: {}, hidden: false, listeners: {},
      setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); },
      addEventListener(t, f) { this.listeners[t] = f; }, querySelector() { return null; }, focus() {},
    });
    return els.get(id);
  };
  el("margin").value = "2"; el("busMin").value = "25"; el("from").value = "11"; el("to").value = "0";
  const ctx = {
    document: { getElementById: el, createElement: () => ({ appendChild() {} }) },
    Option: function (t, v) { this.text = t; this.value = v; },
    localStorage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } },
    window: { scrollTo() {} },
    Date, Math, JSON, Number, String, Map, Set, Array, Object, Error, console,
  };
  vm.runInNewContext(code, ctx);
  if (!el("results").innerHTML.includes("card")) throw new Error("結果が描画されない:\n" + el("results").innerHTML.slice(0, 200));
  // 最終ボタン
  el("last").onclick();
  if (!el("results").innerHTML.includes("最終")) throw new Error("最終が描画されない");
  // 路線図タブ：駅を2つ選ぶと最終が出る（タップは座標→駅の変換を通さず、キー操作で代用）
  el("tabMap").onclick();
  eq(el("viewMap").hidden, false); eq(el("viewSearch").hidden, true);
  if (!el("mapBox").innerHTML.startsWith("<svg")) throw new Error("路線図が描画されない");
  const key = i => el("mapBox").listeners.keydown({ key: "Enter", preventDefault() {}, target: { closest: () => ({ dataset: { i: String(i) } }) } });
  key(0); key(SI["君津"]);
  if (!el("mapResult").innerHTML.includes("20:29")) throw new Error("千葉→君津の最終が出ない:\n" + el("mapResult").innerHTML.slice(0, 300));
  if (!el("mapResult").innerHTML.includes('<details class="map-detail" id="mapDetail">')) throw new Error("内訳が最初から開いている／ない");
  el("dirUp").onclick(); // 上りに切り替え → 君津→千葉
  eq(el("mapSel").textContent, "君津 → 千葉"); // 見出しに「（上りの最終）」は付けない
  eq(el("from").value, SI["君津"]); eq(el("to").value, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
