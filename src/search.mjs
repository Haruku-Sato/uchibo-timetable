/* ===== 経路検索（connection scan） ===== */
import { STATIONS, BUS } from "./data/stations.mjs";

export const SERVICE_START = 4 * 60;  // 4:00
export const SERVICE_END = 28 * 60;   // 翌4:00（0時台は24時以降として扱う）

/**
 * 検索用のネットワークを作る。dayType: "weekday"（平日）| "holiday"（土休日。平日のみの列車を除く）
 */
export function buildNetwork(model, { dayType = "weekday" } = {}) {
  const trains = model.trains.filter(t => dayType === "weekday" || !t.weekdayOnly);
  const ok = new Set(trains.map(t => t.id));
  const conns = [];
  for (const t of trains) {
    for (let k = 0; k < t.stops.length - 1; k++) {
      const a = t.stops[k], b = t.stops[k + 1];
      conns.push({ from: a.s, to: b.s, dep: a.dep, arr: b.arr, arrEst: !!b.arrEst, trip: t.id });
    }
  }
  conns.sort((x, y) => x.dep - y.dep || x.arr - y.arr);
  // 矢印の接続：「列車:駅」→ その駅で必ず接続する列車
  const linksFrom = new Map();
  for (const l of model.links) {
    if (!ok.has(l.fromTrain) || !ok.has(l.toTrain)) continue;
    const key = l.fromTrain + ":" + l.at;
    if (!linksFrom.has(key)) linksFrom.set(key, []);
    linksFrom.get(key).push(l.toTrain);
  }
  const byId = new Map(model.trains.map(t => [t.id, t]));
  return { conns, linksFrom, byId, dayType };
}

function busPeer(s) { return s === BUS.a ? BUS.b : s === BUS.b ? BUS.a : -1; }

/**
 * 時刻 t 以降に origin を出て dest に最も早く着く経路。なければ null。
 * opts: {margin: 乗換余裕(分), busMin: バス所要(分), busFirst/busLast: バスの始発・最終の発車時刻(分。null=指定なし)}
 * 乗換余裕は列車→列車、バス→列車の乗り継ぎにかかる。矢印の接続は余裕に関係なく乗り継げる。
 * バスは運行時間内なら随時乗れるとみなす（始発より前に着いたら始発まで待つ。最終より後は乗れない）。
 * 戻り値: {dep, arr, legs:[{type:"train"|"bus", from, to, dep, arr, arrEst?, train?, linked?}]}
 */
export function earliest(net, origin, dest, t, { margin = 2, busMin = BUS.defaultMin, busFirst = null, busLast = null } = {}) {
  if (origin === dest) return null;
  const N = STATIONS.length, INF = 1e9;
  const arr = Array(N).fill(INF), board = Array(N).fill(INF), label = Array(N).fill(null);
  const ride = new Map();      // 乗っている列車 → {enter, prev, linked}
  const linkBoard = new Map(); // 矢印で乗り継げる列車 → 前の区間のラベル
  arr[origin] = t; board[origin] = t;

  const relaxBus = (s, time, prev) => {
    const o = busPeer(s);
    if (o < 0) return;
    const dep = busFirst == null ? time : Math.max(time, busFirst);
    if (busLast != null && dep > busLast) return;
    const a = dep + busMin;
    if (a < arr[o]) { arr[o] = a; board[o] = a + margin; label[o] = { type: "bus", from: s, to: o, dep, arr: a, prev }; }
  };
  const trainLabel = (r, c) => ({
    type: "train", train: c.trip, from: r.enter.from, to: c.to, dep: r.enter.dep, arr: c.arr,
    arrEst: c.arrEst, linked: r.linked, prev: r.prev,
  });

  relaxBus(origin, t, null);
  for (const c of net.conns) {
    if (c.dep < t) continue;
    if (arr[dest] <= c.dep) break;
    let r = ride.get(c.trip);
    if (!r) {
      const lk = linkBoard.get(c.trip);
      if (board[c.from] <= c.dep) r = { enter: c, prev: label[c.from], linked: false };
      else if (lk && lk.to === c.from) r = { enter: c, prev: lk, linked: true };
      else continue;
      ride.set(c.trip, r);
    }
    const lks = net.linksFrom.get(c.trip + ":" + c.to);
    if (lks) for (const to of lks) if (!linkBoard.has(to)) linkBoard.set(to, trainLabel(r, c));
    if (c.arr < arr[c.to]) {
      arr[c.to] = c.arr; board[c.to] = c.arr + margin;
      label[c.to] = trainLabel(r, c);
      relaxBus(c.to, c.arr, label[c.to]);
    }
  }
  if (!label[dest]) return null;
  const legs = [];
  for (let l = label[dest]; l; l = l.prev) {
    const { prev, ...leg } = l;
    if (leg.type === "train") leg.weekdayOnly = !!net.byId.get(leg.train).weekdayOnly;
    legs.unshift(leg);
  }
  return { dep: legs[0].dep, arr: arr[dest], legs };
}

/**
 * 出発時刻指定（mode "dep"）／到着時刻指定（mode "arr"）で、最大 limit 件の経路を返す（v1 と同じ考え方）。
 * "dep" は早く出る順、"arr" は遅く出る順（先頭が「最終」）。
 */
export function journeys(net, origin, dest, mode, time, opts = {}, limit = 6) {
  const span = 7 * 60;
  const lo = mode === "dep" ? time : Math.max(SERVICE_START, time - span);
  const hi = mode === "dep" ? Math.min(SERVICE_END, time + span) : time;
  const map = new Map();
  for (let t = lo; t <= hi; t++) {
    const j = earliest(net, origin, dest, t, opts);
    if (!j) continue;
    if (mode === "arr" && j.arr > time) continue;
    const prev = map.get(j.arr);
    if (!prev || j.dep > prev.dep) map.set(j.arr, j);
  }
  // 遅く出て早く（同じに）着く経路があるものは除く
  let list = [...map.values()].sort((a, b) => a.dep - b.dep);
  list = list.filter(j => !list.some(k => k !== j && k.dep >= j.dep && k.arr <= j.arr));
  if (list.length && list.every(j => j.legs.every(l => l.type === "bus"))) return mode === "dep" ? list.slice(0, 1) : list.slice(-1);
  return mode === "dep" ? list.slice(0, limit) : list.reverse().slice(0, limit);
}

/**
 * 区間の最終：その日のうち（翌4:00まで）に dest へ着ける、最も遅い出発の経路。
 * バスだけの区間（姉ヶ崎↔長浦）は {busOnly:true} を返す。列車がなければ null。
 */
export function lastJourney(net, origin, dest, opts = {}) {
  if (origin === dest) return null;
  if (busPeer(origin) === dest) return { busOnly: true };
  if (!earliest(net, origin, dest, SERVICE_START, opts)) return null;
  // 経路があるかどうかは出発時刻について単調（早く出れば待てばよい）なので二分探索
  let lo = SERVICE_START, hi = SERVICE_END;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (earliest(net, origin, dest, mid, opts)) lo = mid; else hi = mid - 1;
  }
  return earliest(net, origin, dest, lo, opts);
}

export const TIGHT_MIN = 2;          // 乗換がこの分数以下なら「ギリギリ」
export const BUS_UNSURE_FROM = 22 * 60, BUS_UNSURE_TO = 6 * 60; // 運行時間が未指定のとき「未確認」とする時間帯

/**
 * 画面に出す注意点をまとめる。
 * transfers[k] … legs[k] と legs[k+1] の間：{wait, tight, linked, est(到着が推定), toBus}
 * busUnsure … 運行時間が未指定のまま、22:00以降／6:00前のバスを使っている
 * busStart  … 最初の区間がバス（出発時刻は時刻表の発車ではなく「この時刻までに乗車」）
 */
export function annotate(j, { busFirst = null, busLast = null } = {}) {
  const transfers = [];
  for (let k = 1; k < j.legs.length; k++) {
    const a = j.legs[k - 1], b = j.legs[k];
    const wait = b.dep - a.arr;
    const toBus = b.type === "bus";
    transfers.push({
      wait, toBus, linked: !!b.linked, est: !!a.arrEst,
      tight: !toBus && !b.linked && wait <= TIGHT_MIN,
    });
  }
  const busUnsure = j.legs.some(l => l.type === "bus" &&
    ((busLast == null && l.dep >= BUS_UNSURE_FROM) || (busFirst == null && l.dep < BUS_UNSURE_TO)));
  return {
    transfers,
    tight: transfers.some(t => t.tight),
    estTransfer: transfers.some(t => t.est && !t.toBus),
    busUnsure,
    busStart: j.legs[0].type === "bus",
    hasBus: j.legs.some(l => l.type === "bus"),
    weekdayOnly: j.legs.some(l => l.weekdayOnly),
    arrEst: !!j.legs.at(-1).arrEst,
  };
}
