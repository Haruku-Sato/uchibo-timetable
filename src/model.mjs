/* ===== 時刻表データ → 列車リスト ===== */
import { STATIONS, SI } from "./data/stations.mjs";
import { TABLES } from "./data/timetable.mjs";

/* "H:MM" → 分。0〜3時台は24時以降として扱う。画像の誤字「;」も「:」として読む。 */
export function tm(s) {
  const [h, m] = s.replace(";", ":").split(":").map(Number);
  return (h < 4 ? h + 24 : h) * 60 + m;
}
export function fmt(x) {
  const h = Math.floor(x / 60) % 24, m = x % 60;
  return h + ":" + String(m).padStart(2, "0");
}

const TIME_RE = /^\d{1,2}[:;]\d{2}$/;
/* 「着」がない駅で、推定着が発より この分数以上早いときだけ推定値を使う（長い停車とみなす） */
export const LONG_DWELL_MIN = 3;

/* 行ラベル "蘇我着" → {s, kind:"arr"|"dep"} */
function parseRow(label) {
  const kind = label.endsWith("着") ? "arr" : "dep";
  const name = label.replace(/[発着]$/, "");
  if (!(name in SI)) throw new Error(`未知の駅名: ${label}`);
  return { s: SI[name], kind };
}

/* 1列（セルの配列）を「＝」で区切り、列車ごとのセル範囲に分ける */
function splitColumn(cells, problems, where) {
  const segs = [];
  let cur = [];
  cells.forEach((c, i) => {
    if (c === "=") {
      if (!cur.length) problems.push(`${where}: 「＝」の直前に時刻がない（${i + 1}行目）`);
      else if (cells[i - 1] === ".") problems.push(`${where}: 「＝」の直前が空欄（${i + 1}行目）`);
      if (cur.length) segs.push(cur);
      cur = [];
    } else if (c !== ".") {
      if (cur.length && cells[i - 1] === ".") problems.push(`${where}: 列車の途中に空欄がある（${i + 1}行目の手前）`);
      cur.push(i);
    }
  });
  if (cur.length) segs.push(cur);
  return segs;
}

/**
 * 全時刻表を読み込み、列車とリンク（矢印の接続）を返す。
 * train: {id, table, col, dir, weekdayOnly, stops:[{s, arr, dep, arrGiven, arrEst?}]}
 *   arr = その駅に着く時刻、dep = その駅を出る時刻（始発駅の arr / 終着駅の dep は同じ値）
 *   arrGiven = 時刻表に「着」がある、arrEst = 着時刻を推定した（画面では「頃」を付ける）
 * link:  {at, fromTrain, toTrain, arr, dep}  … 乗換余裕に関係なく必ず乗り継げる
 * problems: データの書式上の問題（空なら OK）
 */
export function buildModel(tables = TABLES) {
  const trains = [], links = [], problems = [];
  for (const tb of tables) {
    const rows = tb.rows.map(parseRow);
    const lines = tb.cols.trim().split("\n").map(l => l.trim().split(/\s+/));
    const weekday = new Set(tb.weekdayOnly || []);
    for (const [col, ...cells] of lines) {
      const where = `${tb.title} 列${col}`;
      if (cells.length !== rows.length) {
        problems.push(`${where}: セル数 ${cells.length}（行数 ${rows.length} と不一致）`);
        continue;
      }
      cells.forEach((c, i) => {
        if (c !== "." && c !== "=" && !TIME_RE.test(c)) problems.push(`${where}: 読めないセル "${c}"（${tb.rows[i]}）`);
      });
      for (const seg of splitColumn(cells, problems, where)) {
        const stops = [];
        for (const i of seg) {
          const { s, kind } = rows[i];
          let st = stops[stops.length - 1];
          if (!st || st.s !== s) stops.push(st = { s });
          st[kind] = tm(cells[i]);
        }
        for (const st of stops) {
          st.arrGiven = st.arr !== undefined; // 時刻表に「着」が載っているか
          st.arr ??= st.dep;
          st.dep ??= st.arr;
        }
        if (stops.length < 2) { problems.push(`${where}: 停車駅が1つしかない列車`); continue; }
        trains.push({
          id: trains.length, table: tb.id, col, dir: tb.dir,
          weekdayOnly: weekday.has(col), stops,
        });
      }
    }
    for (const lk of tb.links || []) {
      const s = SI[lk.at], a = tm(lk.from), d = tm(lk.to);
      const mine = trains.filter(t => t.table === tb.id);
      // 着側は時刻表に書かれた時刻（着がなければ発の欄の時刻）で照合する
      const fromT = mine.filter(t => { const st = t.stops.find(x => x.s === s); return st && st !== t.stops[0] && (st.arrGiven ? st.arr : st.dep) === a; });
      const toT = mine.filter(t => { const st = t.stops.find(x => x.s === s); return st && st !== t.stops.at(-1) && st.dep === d; });
      if (fromT.length !== 1 || toT.length !== 1) {
        problems.push(`${tb.title} 接続 ${lk.at} ${lk.from}→${lk.to}: 列車が特定できない（着${fromT.length}本・発${toT.length}本）`);
        continue;
      }
      links.push({ at: s, fromTrain: fromT[0].id, toTrain: toT[0].id, arr: a, dep: d });
    }
  }
  estimateArrivals(trains);
  return { trains, links, problems };
}

/* 隣り合う駅間（方向つき）の最短所要：全列車での「次駅の着（なければ発）− 前駅の発」の最小値 */
export function minRunTimes(trains) {
  const best = new Map();
  for (const t of trains) {
    for (let k = 1; k < t.stops.length; k++) {
      const pv = t.stops[k - 1], st = t.stops[k];
      const key = pv.s + "-" + st.s;
      const run = (st.arrGiven ? st.arr : st.dep) - pv.dep;
      if (!best.has(key) || run < best.get(key)) best.set(key, run);
    }
  }
  return best;
}

/* 「着」がない駅の着時刻を推定する：着 = min(その駅の発, 前の駅の発 + 最短所要)。
 * 差が LONG_DWELL_MIN 未満なら推定せず発時刻のまま（普通の停車で「頃」が乱発しないように）。 */
function estimateArrivals(trains) {
  const best = minRunTimes(trains);
  for (const t of trains) {
    for (let k = 1; k < t.stops.length; k++) {
      const pv = t.stops[k - 1], st = t.stops[k];
      if (st.arrGiven) continue;
      const est = pv.dep + best.get(pv.s + "-" + st.s);
      if (st.dep - est >= LONG_DWELL_MIN) { st.arr = est; st.arrEst = true; }
    }
  }
}

/* 健全性チェック：駅の並び順と時刻の単調増加。違反を文字列の配列で返す。 */
export function checkTrains(trains) {
  const out = [];
  for (const t of trains) {
    const where = `${t.table} 列${t.col}（${STATIONS[t.stops[0].s]} ${fmt(t.stops[0].dep)}発）`;
    for (let k = 0; k < t.stops.length; k++) {
      const st = t.stops[k];
      if (st.arr > st.dep) out.push(`${where}: ${STATIONS[st.s]} 着${fmt(st.arr)} が 発${fmt(st.dep)} より遅い`);
      if (k === 0) continue;
      const pv = t.stops[k - 1];
      const step = st.s - pv.s;
      if (t.dir === "down" ? step <= 0 : step >= 0) out.push(`${where}: ${STATIONS[pv.s]}→${STATIONS[st.s]} の駅順が${t.dir === "down" ? "下り" : "上り"}と逆`);
      if (st.arr <= pv.dep) out.push(`${where}: ${STATIONS[pv.s]} 発${fmt(pv.dep)} → ${STATIONS[st.s]} ${fmt(st.arr)} が単調増加でない`);
    }
  }
  return out;
}
