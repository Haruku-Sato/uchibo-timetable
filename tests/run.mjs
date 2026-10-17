/* node tests/run.mjs */
import { buildModel, checkTrains, fmt, tm } from "../src/model.mjs";
import { STATIONS, SI } from "../src/data/stations.mjs";
import { buildNetwork, earliest, journeys, lastJourney, annotate } from "../src/search.mjs";
import { build, buildSite, bundleScript, ICONS } from "../build.mjs";
import fs from "node:fs";
import { segmentLasts, mapSvg, mapLayout, mapPath, nearestStation, textBox, FONT, MAP_PTS, MAP_SEGMENTS, MAP_VIEWBOX, SEA_LABELS } from "../src/ui/map.mjs";
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

/* ===== 段階6：総武線（千葉〜津田沼）・京葉線（蘇我〜海浜幕張〜新習志野） ===== */
const HOL = buildNetwork(model, { dayType: "holiday" });
const lines = j => j.legs.map(l => l.type === "bus" ? "バス" : (trains[l.train].line || "内房線")).join(" / ");
test("追加区間：16表すべて読め、平日・土休日に分かれ、着は推定（頃）", () => {
  const ex = trains.filter(t => t.extra);
  eq(new Set(ex.map(t => t.table)).size, 16);
  if (ex.length < 1500) throw new Error(`本数 ${ex.length}`);
  for (const t of ex) {
    if (!["weekday", "holiday"].includes(t.days)) throw new Error(t.table);
    if (!t.stops.slice(1).every(s => s.arrEst)) throw new Error(`${t.table} ${t.col}`);
  }
  // 平日のネットワークに土休日の列車は入らない（逆も）
  const wkIds = new Set(net.conns.map(c => c.trip)), holIds = new Set(HOL.conns.map(c => c.trip));
  for (const t of ex) if ((t.days === "weekday") !== wkIds.has(t.id) || (t.days === "holiday") !== holIds.has(t.id)) throw new Error(`${t.table} ${t.col}`);
});
test("追加区間：特急や行き先記号が紛れ込んでいない（記号は 快・幕 だけ）", () => {
  for (const t of trains.filter(t => t.extra)) if (!/^\d{1,2}:\d{2}(快|幕)?$/.test(t.col)) throw new Error(`${t.table} ${t.col}`);
  // 快速は新習志野に停まらない、幕は蘇我へ行かない
  for (const t of trains.filter(t => t.extra && t.col.endsWith("快"))) if (t.stops.some(s => s.s === SI["新習志野"])) throw new Error(`${t.table} ${t.col}`);
  for (const t of trains.filter(t => t.extra && t.col.endsWith("幕"))) eq(STATIONS[t.stops.at(-1).s], "海浜幕張", `${t.table} ${t.col}`);
});
test("津田沼→千葉：10:05発の快速は千葉10:16着", () => {
  const j = earliest(net, SI["津田沼"], SI["千葉"], tm("10:05"), O);
  eq(fmt(j.dep), "10:05", legStr(j)); eq(fmt(j.arr), "10:16"); eq(lines(j), "総武線快速"); eq(j.legs[0].arrEst, true);
});
test("千葉→津田沼：平日12:02発の快速は津田沼12:12頃着", () => {
  const j = earliest(net, SI["千葉"], SI["津田沼"], tm("12:02"), O);
  eq(fmt(j.dep), "12:02", legStr(j)); eq(fmt(j.arr), "12:12"); eq(lines(j), "総武線快速"); eq(annotate(j, O).arrEst, true);
});
test("新習志野→蘇我：平日11:13発の普通は蘇我11:30頃着（直通）", () => {
  const j = earliest(net, SI["新習志野"], SI["蘇我"], tm("11:13"), O);
  eq(fmt(j.dep), "11:13", legStr(j)); eq(fmt(j.arr), "11:30"); eq(j.legs.length, 1); eq(lines(j), "京葉線");
});
test("新習志野→蘇我（土休日12:00以降）：海浜幕張で乗り換える（普通12:04 海浜幕張行 → 快速12:18）", () => {
  const j = earliest(HOL, SI["新習志野"], SI["蘇我"], tm("12:00"), O);
  eq(j.legs.length, 2, legStr(j)); eq(STATIONS[j.legs[0].to], "海浜幕張");
  eq(fmt(j.legs[0].dep), "12:04"); eq(fmt(j.legs[1].dep), "12:18"); eq(lines(j), "京葉線 / 京葉線快速");
  const list = journeys(HOL, SI["新習志野"], SI["蘇我"], "dep", tm("12:00"), O);
  if (list.some(k => k.legs.length === 1 && k.dep < tm("16:00"))) throw new Error("土休日の日中に直通が出ている");
});
test("蘇我→新習志野（土休日11:00以降）：快速で海浜幕張へ行き、普通に乗り換える", () => {
  const j = earliest(HOL, SI["蘇我"], SI["新習志野"], tm("11:00"), O);
  eq(j.legs.length, 2, legStr(j)); eq(STATIONS[j.legs[0].to], "海浜幕張");
  eq(lines(j), "京葉線快速 / 京葉線"); eq(fmt(j.legs[0].dep), "11:05"); eq(fmt(j.arr), "11:24");
});
test("君津→津田沼：平日10:00までに着く経路があり、千葉で乗り換える", () => {
  const list = journeys(net, SI["君津"], SI["津田沼"], "arr", tm("10:00"), O);
  if (!list.length) throw new Error("経路なし");
  const j = list[0];
  eq(STATIONS[j.legs.at(-1).from], "千葉", legStr(j)); if (!/^総武線/.test(lines(j).split(" / ").at(-1))) throw new Error(lines(j));
  if (j.arr > tm("10:00")) throw new Error(legStr(j));
});
test("君津→新習志野：蘇我で京葉線に乗り換える", () => {
  const j = earliest(net, SI["君津"], SI["新習志野"], tm("9:00"), O);
  const k = j.legs.findIndex(l => l.type === "train" && trains[l.train].line?.startsWith("京葉線"));
  if (k < 0) throw new Error(legStr(j));
  eq(STATIONS[j.legs[k].from], "蘇我", legStr(j));
});
test("路線図：枝線の区間の最終と、駅をたどる経路", () => {
  const dn = segmentLasts(net, "down", O); // 下り＝津田沼→千葉、新習志野→海浜幕張、海浜幕張→蘇我
  const i = MAP_SEGMENTS.findIndex(g => g.a === SI["津田沼"]);
  if (!/^0:\d{2}$/.test(dn[i].text)) throw new Error(dn[i].text);
  eq(mapPath(SI["津田沼"], SI["新習志野"]).length, 5); // 津田沼-千葉-本千葉-蘇我-海浜幕張-新習志野
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
test("路線図：駅の座標が全駅ぶん、隣の駅と近すぎない", () => {
  eq(MAP_PTS.length, STATIONS.length);
  for (const { a, b } of MAP_SEGMENTS) {
    const d = Math.hypot(MAP_PTS[a][0] - MAP_PTS[b][0], MAP_PTS[a][1] - MAP_PTS[b][1]);
    if (d < 26) throw new Error(`${STATIONS[a]}〜${STATIONS[b]} の間隔 ${d.toFixed(1)}`);
  }
  for (let i = 0; i < MAP_PTS.length; i++) eq(nearestStation(MAP_PTS[i][0] + 3, MAP_PTS[i][1] - 3), i, STATIONS[i]);
  eq(nearestStation(40, 400), -1);
});
test("路線図：区間ごとの最終（下り 木更津→君津 23:14、上り 君津→木更津 22:59、姉ヶ崎〜長浦はバス）", () => {
  const dn = segmentLasts(net, "down", O), up = segmentLasts(net, "up", O);
  eq(dn.length, MAP_SEGMENTS.length); eq(up.length, MAP_SEGMENTS.length); eq(MAP_SEGMENTS.length, 34); // 内房線31＋総武線1＋京葉線2
  eq(dn[SI["木更津"]].text, "23:14"); eq(up[SI["木更津"]].text, "22:59");
  eq(dn[SI["姉ヶ崎"]].bus, true); eq(up[SI["姉ヶ崎"]].text, "バス");
  eq(segmentLasts(net, "up", { ...O, busLast: tm("21:30") })[SI["姉ヶ崎"]].text, "バス〜21:30");
  eq(dn[SI["長浦"]].text, "21:33"); eq(dn[0].text, "0:10");
  for (const g of [...dn, ...up]) if (!/^(\d{1,2}:\d{2}|バス.*)$/.test(g.text)) throw new Error(g.text);
});
test("路線図：SVG に全駅・点線のバス区間・枝線・選択区間・区間ごとの時刻が入る", () => {
  const svg = mapSvg({ sel: { a: 0, b: SI["君津"] }, segs: segmentLasts(net, "down", O), dirLabel: "下り" });
  eq((svg.match(/<g class="st/g) || []).length, 35);
  eq((svg.match(/class="bus-line"/g) || []).length, 1);
  eq((svg.match(/class="branch sobu"/g) || []).length, 1); eq((svg.match(/class="branch keiyo"/g) || []).length, 2);
  eq((svg.match(/class="sel-line( bus)?"/g) || []).length, 11); // 千葉〜君津の11区間（うちバス1）
  eq((svg.match(/<text class="seg/g) || []).length, 34);
  eq((svg.match(/aria-pressed="true"/g) || []).length, 2);
  if (/NaN|undefined/.test(svg)) throw new Error("NaN/undefined を含む");
});

test("路線図：文字どうし・文字と駅の丸・文字と線路が重ならず、枠からはみ出さない（文字幅は概算）", () => {
  const [vx, vy, vw, vh] = MAP_VIEWBOX.split(" ").map(Number);
  const GAP = 1.5; // 箱どうしの最小のすき間
  const probs = new Set();
  const hit = (a, b) => a.x0 < b.x1 + GAP && b.x0 < a.x1 + GAP && a.y0 < b.y1 + GAP && b.y0 < a.y1 + GAP;
  const boxCircle = (b, c) => Math.hypot(Math.max(b.x0 - c.x, 0, c.x - b.x1), Math.max(b.y0 - c.y, 0, c.y - b.y1)) < c.r + 1.5 + GAP;
  const sels = [{}, { a: SI["館山"], b: SI["千歳"] }, { a: SI["九重"], b: SI["千倉"] }, { a: 0, b: SI["安房鴨川"] },
    { a: SI["津田沼"], b: SI["新習志野"] }, { a: SI["蘇我"], b: SI["海浜幕張"] }];
  for (const o of [O, { ...O, busLast: tm("21:30") }]) for (const dir of ["down", "up"]) for (const dayType of ["weekday", "holiday"]) for (const sel of sels) {
    const L = mapLayout(segmentLasts(buildNetwork(model, { dayType }), dir, o), sel);
    const texts = [
      ...L.stations.map(st => ({ str: STATIONS[st.i], box: st.label.box })),
      ...L.segs.map(g => ({ str: g.text, box: g.box })),
      ...SEA_LABELS.map(t => ({ str: t.text, box: textBox(t.x, t.y, "start", t.text, FONT.sea + 3) })), // letter-spacing ぶん広めに
    ];
    texts.forEach((a, i) => texts.slice(i + 1).forEach(b => { if (hit(a.box, b.box)) probs.add(`${dir} 文字の重なり ${a.str} / ${b.str}`); }));
    for (const t of texts) {
      const b = t.box;
      if (b.x0 < vx || b.x1 > vx + vw || b.y0 < vy + 2 || b.y1 > vy + vh - 6) probs.add(`${dir} 枠に近い ${t.str}`);
      for (const c of L.stations) if (boxCircle(b, c) && t.str !== STATIONS[c.i]) probs.add(`${dir} 丸と重なる ${t.str} / ${STATIONS[c.i]}の丸`);
      outer: for (const { a: sa, b: sb } of MAP_SEGMENTS) for (let k = 0; k <= 20; k++) {
        const [p, q] = [MAP_PTS[sa], MAP_PTS[sb]];
        const x = p[0] + (q[0] - p[0]) * k / 20, y = p[1] + (q[1] - p[1]) * k / 20;
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
  eq((svg.match(/class="sel-line"/g) || []).length, 10);
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
    // 現在時刻に左右されないよう、平日（2026-10-14 水）の 10:00 に固定する
    Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(2026, 9, 14, 10, 0); } },
    Math, JSON, Number, String, Map, Set, Array, Object, Error, console,
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

/* ===== 段階7：PWA 版（site/） ===== */
const site = buildSite();
const siteFile = p => new URL(`../site/${p}`, import.meta.url);
test("site/index.html：doctype・viewport・manifest・apple-touch-icon・standalone 指定・SW 登録", () => {
  const h = fs.readFileSync(siteFile("index.html"), "utf8");
  if (!h.startsWith("<!doctype html>\n<html lang=\"ja\">")) throw new Error("doctype / lang");
  for (const re of [
    /<meta charset="utf-8">/, /<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">/,
    /<link rel="manifest" href="manifest.webmanifest">/, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon.png">/,
    /<meta name="apple-mobile-web-app-capable" content="yes">/, /<meta name="apple-mobile-web-app-title" content="内房線">/,
    /<meta name="theme-color" content="[^"]+" media="\(prefers-color-scheme: light\)">/, /<meta name="theme-color" content="[^"]+" media="\(prefers-color-scheme: dark\)">/,
    /\[hidden\]\{display:none!important\}/, /safe-area-inset-top/, /body\{margin:0\}/,
    /navigator\.serviceWorker\.register\("sw\.js"\)/, /fonts\.googleapis\.com[^"]*display=swap/,
    new RegExp(`アプリ [0-9-]+ [0-9:]+ 版（${site.version}）`), /<\/head>\s*<body>/, /<\/html>\s*$/,
  ]) if (!re.test(h)) throw new Error(`ない: ${re}`);
  if (/__VERSION__|<!--APPVER-->|\/\*(STYLE|SCRIPT)\*\//.test(h)) throw new Error("置き換え漏れ");
  // 本体は dist と同じ（版の表示だけが違う）
  const dist = fs.readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const core = dist.slice(dist.indexOf("<script>"), dist.lastIndexOf("</script>"));
  if (!h.includes(core)) throw new Error("本体のスクリプトが dist と違う");
  if (dist.includes("serviceWorker") || dist.includes("アプリ ")) throw new Error("dist に PWA 用のものが入っている");
});
test("site/manifest.webmanifest：JSON・必要な項目・実在するアイコン", () => {
  const m = JSON.parse(fs.readFileSync(siteFile("manifest.webmanifest"), "utf8"));
  eq(m.name, "内房線 臨時ダイヤ 乗換検索"); eq(m.short_name, "内房線"); eq(m.display, "standalone");
  eq(m.start_url, "./"); eq(m.scope, "./");
  if (!m.background_color || !m.theme_color) throw new Error("色がない");
  eq(m.icons.map(i => i.sizes).join(","), "192x192,512x512");
  for (const i of m.icons) {
    const buf = fs.readFileSync(siteFile(i.src));
    eq(buf.subarray(1, 4).toString(), "PNG", i.src);
    eq(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`, i.sizes, i.src); // PNG の IHDR の幅・高さ
  }
  const at = fs.readFileSync(siteFile("icons/apple-touch-icon.png"));
  eq(`${at.readUInt32BE(16)}x${at.readUInt32BE(20)}`, "180x180");
  if (!fs.existsSync(siteFile(".nojekyll"))) throw new Error(".nojekyll がない");
});

/* Service Worker を偽の環境で動かす */
async function runSW({ online = true, slowNet = false } = {}) {
  const code = fs.readFileSync(siteFile("sw.js"), "utf8");
  new vm.Script(code);
  const stores = new Map(), listeners = {}, fetched = [];
  const keyOf = k => typeof k === "string" ? new URL(k, "https://example.github.io/uchibo-timetable/sw.js").href : k.url;
  class Res { constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.ok = this.status < 300; this.type = "basic"; } clone() { return new Res(this.body, { status: this.status }); } }
  class Req { constructor(u, init = {}) { this.url = keyOf(u); this.method = "GET"; this.mode = init.mode || "cors"; this.cache = init.cache; } }
  const cacheObj = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      addAll: async reqs => { for (const r of reqs) m.set(keyOf(r), new Res(`net:${keyOf(r)}`)); fetched.push(...reqs.map(r => [keyOf(r), r.cache])); },
      match: async (k, o = {}) => { const u = keyOf(k); return m.get(o.ignoreSearch ? u.split("?")[0] : u); },
      put: async (k, r) => { m.set(keyOf(k), r); },
    };
  };
  const ctx = {
    self: { addEventListener: (t, f) => { listeners[t] = f; }, location: { origin: "https://example.github.io" }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async n => cacheObj(n), keys: async () => [...stores.keys()], delete: async n => stores.delete(n) },
    fetch: req => {
      fetched.push([req.url, "fetch"]);
      if (!online) return Promise.reject(new Error("offline"));
      return slowNet ? new Promise(() => {}) : Promise.resolve(new Res(`new:${req.url}`));
    },
    Request: Req, Response: Res, URL, Promise, console,
  };
  vm.runInNewContext(code, ctx);
  const ev = (type, extra = {}) => { const waits = []; let responded; listeners[type]({ ...extra, waitUntil: p => waits.push(p), respondWith: p => { responded = p; } }); return { waits, responded }; };
  return { ctx, stores, fetched, ev, Req };
}
const tests7 = [];
const atest = (name, fn) => tests7.push([name, fn]);
atest("sw.js：構文エラーなし・キャッシュ名に版・install で index などをキャッシュ（HTTP キャッシュを使わない）", async () => {
  const sw = await runSW();
  sw.stores.set("uchibo-old", new Map()); sw.stores.set("uchibo-fonts", new Map()); sw.stores.set("other-app", new Map());
  const i = sw.ev("install"); await Promise.all(i.waits);
  const name = `uchibo-${site.version}`;
  if (!sw.stores.has(name)) throw new Error("版の入ったキャッシュがない: " + [...sw.stores.keys()]);
  const keys = [...sw.stores.get(name).keys()].map(k => k.replace("https://example.github.io/uchibo-timetable/", ""));
  for (const k of ["", "index.html", "manifest.webmanifest", ...ICONS.map(f => "icons/" + f)]) if (!keys.includes(k)) throw new Error(`キャッシュにない: "${k}"`);
  if (!sw.fetched.every(([, c]) => c === "reload")) throw new Error("install で HTTP キャッシュを使っている");
  const a = sw.ev("activate"); await Promise.all(a.waits);
  eq([...sw.stores.keys()].sort().join(","), ["other-app", "uchibo-fonts", name].sort().join(","), "activate で古い版だけ消す");
});
atest("sw.js：ページはキャッシュを先に返す（ネットが遅くても待たない）、裏で取り直す", async () => {
  const sw = await runSW({ slowNet: true });
  const name = `uchibo-${site.version}`;
  sw.stores.set(name, new Map([["https://example.github.io/uchibo-timetable/index.html", new sw.ctx.Response("cached")]]));
  const f = sw.ev("fetch", { request: new sw.Req("https://example.github.io/uchibo-timetable/?from=1", { mode: "navigate" }) });
  const res = await Promise.race([f.responded, new Promise(r => setTimeout(() => r("timeout"), 200))]);
  eq(res?.body, "cached", "キャッシュをすぐ返す");
  if (!sw.fetched.some(([u, k]) => k === "fetch" && u.includes("?from=1"))) throw new Error("裏でネットに取りに行っていない");
  eq(f.waits.length, 1, "裏の取り直しを waitUntil で待つ");
});
atest("sw.js：キャッシュがあれば裏の取り直しでキャッシュを新しくする／圏外でキャッシュもなければ 503", async () => {
  const sw = await runSW();
  const name = `uchibo-${site.version}`, u = "https://example.github.io/uchibo-timetable/index.html";
  sw.stores.set(name, new Map([[u, new sw.ctx.Response("old")]]));
  const f = sw.ev("fetch", { request: new sw.Req(u, { mode: "navigate" }) });
  eq((await f.responded).body, "old"); await Promise.all(f.waits);
  eq(sw.stores.get(name).get(u).body, `new:${u}`, "次に開いたときは新しい版");
  const off = await runSW({ online: false });
  const g = off.ev("fetch", { request: new off.Req("https://example.github.io/uchibo-timetable/index.html", { mode: "navigate" }) });
  eq((await g.responded).status, 503);
});
atest("sw.js：Google Fonts は実行時にフォント用のキャッシュへ入れる。ほかのサイトには手を出さない", async () => {
  const sw = await runSW();
  const u = "https://fonts.gstatic.com/s/bizudpgothic/v1/a.woff2";
  const f = sw.ev("fetch", { request: new sw.Req(u) });
  await f.responded; await Promise.all(f.waits);
  eq(sw.stores.get("uchibo-fonts").has(u), true);
  const o = sw.ev("fetch", { request: new sw.Req("https://cdnjs.cloudflare.com/x.js") });
  eq(o.responded, undefined);
});
for (const [name, fn] of tests7) {
  try { await fn(); passed++; console.log(`ok   ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n     ${String(e.message).replace(/\n/g, "\n     ")}`); }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
