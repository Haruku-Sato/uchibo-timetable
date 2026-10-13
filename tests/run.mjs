/* node tests/run.mjs */
import { buildModel, checkTrains, fmt, tm } from "../src/model.mjs";
import { STATIONS, SI } from "../src/data/stations.mjs";

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
test("君津着の推定（下り 木更津15:17発 → 君津着15:24、発15:44）", () => {
  const t = trains.find(t => t.table === "down-kisarazu-awakamogawa" && fmt(t.stops[0].dep) === "15:17");
  const k = stopAt(t, "君津");
  eq(fmt(k.arr), "15:24"); eq(fmt(k.dep), "15:44"); eq(k.arrEst, true);
});
test("矢印の接続が5本とも列車に結びつく", () => {
  eq(links.length, 5);
  const desc = links.map(l => `${STATIONS[l.at]} ${fmt(l.arr)}→${fmt(l.dep)}`).sort().join(", ");
  eq(desc, "上総湊 8:08→8:09, 館山 6:59→7:10, 館山 7:05→7:16, 館山 7:58→8:01, 館山 8:00→8:01");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
