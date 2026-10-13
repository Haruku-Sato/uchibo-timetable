/* ===== UI（検索画面） ===== */
import { STATIONS, BUS } from "../data/stations.mjs";
import { buildModel, fmt, tm } from "../model.mjs";
import { buildNetwork, journeys, lastJourney, annotate } from "../search.mjs";
import { segmentLasts, mapSvg, nearestStation } from "./map.mjs";

const MODEL = buildModel();
const NETS = { weekday: buildNetwork(MODEL, { dayType: "weekday" }), holiday: buildNetwork(MODEL, { dayType: "holiday" }) };
const STORE_KEY = "uchibo-v2";
const GROUPS = [["千葉〜姉ヶ崎", 0, 6], ["長浦〜木更津", 7, 10], ["君津〜館山", 11, 23], ["九重〜安房鴨川", 24, 31]];

const $ = id => document.getElementById(id);
const fromSel = $("from"), toSel = $("to");
for (const sel of [fromSel, toSel]) {
  for (const [name, a, b] of GROUPS) {
    const g = document.createElement("optgroup");
    g.label = name;
    for (let i = a; i <= b; i++) g.appendChild(new Option(STATIONS[i], i));
    sel.appendChild(g);
  }
}

const state = { mode: "dep", dayType: "weekday", showLast: false, tab: "search" };
const mapState = { a: null, b: null, dir: "down", detail: false }; // a = 出発駅、b = 到着駅、detail = 内訳を開いているか

function load() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); } catch (e) { return {}; } }
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      from: fromSel.value, to: toSel.value, mode: state.mode, margin: $("margin").value,
      busMin: $("busMin").value, busFirst: $("busFirst").value, busLast: $("busLast").value,
      tab: state.tab, mapA: mapState.a, mapB: mapState.b, mapDir: mapState.dir,
    }));
  } catch (e) { /* localStorage が使えなくても動く */ }
}
const saved = load();
fromSel.value = saved.from ?? "11";
toSel.value = saved.to ?? "0";
if (saved.margin) $("margin").value = saved.margin;
if (saved.mode === "arr" || saved.mode === "dep") state.mode = saved.mode;
$("busMin").value = clampBus(saved.busMin ?? BUS.defaultMin);
$("busFirst").value = saved.busFirst || "";
$("busLast").value = saved.busLast || "";
if (saved.tab === "map") state.tab = "map";
const validSt = v => Number.isInteger(v) && v >= 0 && v < STATIONS.length;
if (validSt(saved.mapA)) mapState.a = saved.mapA;
if (validSt(saved.mapB) && saved.mapB !== mapState.a && mapState.a != null) mapState.b = saved.mapB;
if (saved.mapDir === "up") mapState.dir = "up";
const dow = new Date().getDay();
state.dayType = dow === 0 || dow === 6 ? "holiday" : "weekday";

function clampBus(v) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(120, Math.max(1, n)) : BUS.defaultMin; }
function nowStr() { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function timeVal(el) { return el.value ? tm(el.value) : null; }
function opts() {
  return { margin: +$("margin").value, busMin: clampBus($("busMin").value), busFirst: timeVal($("busFirst")), busLast: timeVal($("busLast")) };
}
$("time").value = nowStr();

function setPressed() {
  $("mDep").setAttribute("aria-pressed", state.mode === "dep");
  $("mArr").setAttribute("aria-pressed", state.mode === "arr");
  $("dWk").setAttribute("aria-pressed", state.dayType === "weekday");
  $("dHol").setAttribute("aria-pressed", state.dayType === "holiday");
}
function rerun() { state.showLast = false; run(); }
$("mDep").onclick = () => { state.mode = "dep"; rerun(); };
$("mArr").onclick = () => { state.mode = "arr"; rerun(); };
$("dWk").onclick = () => { state.dayType = "weekday"; run(); };
$("dHol").onclick = () => { state.dayType = "holiday"; run(); };
$("swap").onclick = () => { const a = fromSel.value; fromSel.value = toSel.value; toSel.value = a; run(); };
$("now").onclick = () => { $("time").value = nowStr(); rerun(); };
$("last").onclick = () => { state.showLast = true; run(); };
$("busDec").onclick = () => { $("busMin").value = clampBus(+$("busMin").value - 1); run(); };
$("busInc").onclick = () => { $("busMin").value = clampBus(+$("busMin").value + 1); run(); };
$("busMin").addEventListener("change", () => { $("busMin").value = clampBus($("busMin").value); run(); });
$("busClear").onclick = () => { $("busFirst").value = ""; $("busLast").value = ""; run(); };
[fromSel, toSel, $("margin"), $("busFirst"), $("busLast")].forEach(el => el.addEventListener("change", run));
$("time").addEventListener("change", rerun);
$("f").addEventListener("submit", e => { e.preventDefault(); run(); });

function durStr(m) { const h = Math.floor(m / 60), mm = m % 60; return h ? `${h}時間${mm}分` : `${mm}分`; }
function busHoursStr(o) {
  if (o.busFirst == null && o.busLast == null) return "運行時間 指定なし";
  return `運行 ${o.busFirst == null ? "指定なし" : fmt(o.busFirst)}〜${o.busLast == null ? "指定なし" : fmt(o.busLast)}`;
}
function busStartText(j, o) {
  const b = j.legs[0], n = j.legs[1];
  const pre = n ? `${STATIONS[n.from]} ${fmt(n.dep)} 発に乗るには、` : "";
  return `${pre}${STATIONS[b.from]} ${fmt(b.dep)} までにバスに乗車（${o.busMin}分想定）`;
}
const tmHtml = (x, est) => `${fmt(x)}${est ? "<small>頃</small>" : ""}`;

function render(j, i, o, tag) {
  const a = annotate(j, o);
  let html = "";
  j.legs.forEach((l, k) => {
    const isBus = l.type === "bus";
    if (k === 0 && isBus) {
      html += `<li class="stop bus"><span class="tm">${fmt(l.dep)}</span><span class="dot"></span><span class="nm">${STATIONS[l.from]} バス乗車 <em>この時刻までに（随時運行と仮定）</em></span></li>`;
    } else {
      html += `<li class="stop${isBus ? " bus" : ""}"><span class="tm">${fmt(l.dep)}</span><span class="dot"></span><span class="nm">${STATIONS[l.from]} ${isBus ? "バス乗車" : "発"}</span></li>`;
    }
    let info;
    if (isBus) info = `バス（${o.busMin}分想定・随時運行と仮定）`;
    else {
      const tr = MODEL.trains[l.train];
      info = `内房線 ${STATIONS[tr.stops.at(-1).s]}行　${l.arr - l.dep}分${l.weekdayOnly ? "　<b>平日のみ</b>" : ""}`;
    }
    html += `<li class="seg-line${isBus ? " bus" : ""}"><span></span><span class="bar"></span><span class="info">${info}</span></li>`;
    html += `<li class="stop${isBus ? " bus" : ""}"><span class="tm">${tmHtml(l.arr, l.arrEst)}</span><span class="dot"></span><span class="nm">${STATIONS[l.to]} 着</span></li>`;
    const t = a.transfers[k];
    if (t) {
      let cls = "", txt;
      if (t.toBus) txt = t.wait > 0 ? `バス待ち ${t.wait}分` : "そのままバスへ";
      else if (t.linked) { cls = " linked"; txt = `乗換 ${t.wait}分・接続列車（待ち合わせあり）`; }
      else {
        txt = `乗換 ${t.est ? "約" : ""}${t.wait}分`;
        if (t.est) { cls = " est"; txt += "（到着は推定）"; }
        if (t.tight) { cls = " tight"; txt += "・ギリギリ"; }
      }
      html += `<li class="wait${cls}"><span></span><span class="bar"></span><span>${txt}</span></li>`;
    }
  });
  const chips = [
    tag ? `<span class="chip tag">${tag}</span>` : "",
    `<span class="chip">乗換${j.legs.length - 1}回</span>`,
    a.hasBus ? '<span class="chip bus">バス利用</span>' : "",
    a.weekdayOnly ? '<span class="chip">平日のみの列車</span>' : "",
    a.transfers.some(t => t.linked) ? '<span class="chip ok">接続列車</span>' : "",
    a.tight ? '<span class="chip warn">乗換2分以下あり</span>' : "",
    a.estTransfer ? '<span class="chip est">到着時刻は推定</span>' : "",
  ].join("");
  const notes = [
    a.busStart ? `<p class="note">${busStartText(j, o)}。時刻表上の発車時刻ではありません。</p>` : "",
    a.busUnsure ? `<p class="note">バスの運行時間は未確認です（22時以降・6時前のバスを含みます）。設定で始発・最終を指定できます。</p>` : "",
  ].join("");
  return `<article class="card${i === 0 ? " best" : ""}">
    <div class="top"><span class="t">${fmt(j.dep)}${a.busStart ? '<small class="by">までに乗車</small>' : ""}</span><span class="arrow">→</span><span class="t">${tmHtml(j.arr, a.arrEst)}</span></div>
    <div class="meta"><div class="chips">${chips}</div><span class="dur"><b>${durStr(j.arr - j.dep)}</b></span></div>${notes}
    <details class="route"${i === 0 ? " open" : ""}><summary>経路を見る</summary><ol class="legs">${html}</ol></details>
  </article>`;
}

function run() {
  save();
  setPressed();
  const o = opts();
  $("setSummary").textContent = `余裕${o.margin}分・バス${o.busMin}分・${busHoursStr(o)}`;
  if (state.tab === "map") renderMap();
  const from = +fromSel.value, to = +toSel.value;
  const net = NETS[state.dayType];
  const res = $("results"), sum = $("summary");
  const day = state.dayType === "weekday" ? "平日" : "土休日";
  if (from === to) { res.innerHTML = '<div class="empty">出発駅と到着駅が同じです。別の駅を選んでください。</div>'; sum.textContent = ""; return; }

  if (state.showLast) {
    const j = lastJourney(net, from, to, o);
    sum.textContent = `${STATIONS[from]} → ${STATIONS[to]}　この区間の最終（${day}・乗換余裕${o.margin}分）`;
    if (!j) { res.innerHTML = '<div class="empty">この区間に乗れる列車がありません。</div>'; return; }
    if (j.busOnly) {
      res.innerHTML = `<div class="empty">${STATIONS[from]}〜${STATIONS[to]}はバスのみの区間です（${o.busMin}分想定）。${o.busLast == null ? "バスの最終は未確認です。" : `設定上のバス最終は ${fmt(o.busLast)} です。`}</div>`;
      return;
    }
    res.innerHTML = render(j, 0, o, "最終");
    return;
  }

  const time = tm($("time").value || "09:00");
  const list = journeys(net, from, to, state.mode, time, o);
  sum.textContent = `${STATIONS[from]} → ${STATIONS[to]}　${fmt(time)} ${state.mode === "dep" ? "以降に出発" : "までに到着"}（${day}・乗換余裕${o.margin}分）`;
  if (!list.length) {
    res.innerHTML = `<div class="empty">${state.mode === "dep" ? "この時刻以降に乗れる列車がありません。" : "この時刻までに着ける列車がありません。"}時刻を変えてみてください。</div>`;
    return;
  }
  res.innerHTML = list.map((j, i) => render(j, i, o, i === 0 ? (state.mode === "arr" ? "最終" : "先発") : "")).join("");
}
/* ===== タブ ===== */
function showTab(name) {
  state.tab = name;
  $("tabSearch").setAttribute("aria-selected", name === "search");
  $("tabMap").setAttribute("aria-selected", name === "map");
  $("viewSearch").hidden = name !== "search";
  $("viewMap").hidden = name !== "map";
  run();
}
$("tabSearch").onclick = () => showTab("search");
$("tabMap").onclick = () => showTab("map");

/* ===== 路線図 ===== */
function legLine(l, o) {
  if (l.type === "bus") return `<li class="bus">${STATIONS[l.from]} ${fmt(l.dep)} → ${STATIONS[l.to]} ${fmt(l.arr)}　バス（${o.busMin}分想定）</li>`;
  const tr = MODEL.trains[l.train];
  return `<li>${STATIONS[l.from]} ${fmt(l.dep)} → ${STATIONS[l.to]} ${tmHtml(l.arr, l.arrEst)}　${STATIONS[tr.stops.at(-1).s]}行${l.weekdayOnly ? "（平日のみ）" : ""}</li>`;
}
function renderMapResult(o) {
  const { a, b } = mapState;
  const sel = $("mapSel"), res = $("mapResult");
  if (a == null) { sel.innerHTML = '出発駅を<span class="muted">路線図でタップ</span>'; res.innerHTML = ""; return; }
  if (b == null) { sel.innerHTML = `${STATIONS[a]} → <span class="muted">到着駅をタップ</span>`; res.innerHTML = ""; return; }
  sel.textContent = `${STATIONS[a]} → ${STATIONS[b]}`; // 上り／下りはボタンで分かるので書かない
  const j = lastJourney(NETS[state.dayType], a, b, o);
  const toSearch = '<div class="map-actions"><button type="button" class="now last" id="mapToSearch">検索画面で見る</button></div>';
  if (!j) { res.innerHTML = '<p class="map-hint">この区間に乗れる列車がありません。</p>'; return; }
  if (j.busOnly) {
    res.innerHTML = `<p class="note">バスのみの区間です（${o.busMin}分想定）。${o.busLast == null ? "バスの最終は未確認です。" : `設定上のバス最終は ${fmt(o.busLast)} です。`}</p>`;
    return;
  }
  const an = annotate(j, o);
  let legs = "";
  j.legs.forEach((l, k) => {
    legs += legLine(l, o);
    const t = an.transfers[k];
    if (t && !t.toBus) {
      let txt = `${STATIONS[l.to]}で乗換 ${t.est ? "約" : ""}${t.wait}分`;
      if (t.linked) txt += "・接続列車（待ち合わせあり）";
      else if (t.est) txt += "（到着は推定）";
      if (t.tight) txt += "・ギリギリ";
      legs += `<li class="wait${t.tight ? " tight" : t.linked ? " linked" : t.est ? " est" : ""}">${txt}</li>`;
    }
  });
  // 閉じた状態は「最終 20:29 発 → 21:58 着」の1行だけ。内訳・注意・ボタンは「内訳を見る」の中
  const flags = [an.tight ? "ギリギリあり" : "", an.busUnsure ? "バス時間未確認" : ""].filter(Boolean).join("・");
  res.innerHTML = `<div class="map-big"><span class="lbl">最終</span><span class="t">${fmt(j.dep)}</span><span class="lbl">${an.busStart ? "までにバス乗車" : "発"}</span>` +
    `<span class="arr">→ <b>${tmHtml(j.arr, an.arrEst)}</b> 着</span></div>` +
    `<details class="map-detail" id="mapDetail"${mapState.detail ? " open" : ""}><summary>内訳を見る（乗換${j.legs.length - 1}回）${flags ? `<span class="map-chip">${flags}</span>` : ""}</summary><div>` +
    `<ol class="map-legs">${legs}</ol>` +
    (an.busStart ? `<p class="note">${busStartText(j, o)}。時刻表上の発車時刻ではありません。</p>` : "") +
    (an.busUnsure ? '<p class="note">バスの運行時間は未確認です。設定で始発・最終を指定できます。</p>' : "") +
    toSearch + "</div></details>";
  $("mapDetail").addEventListener("toggle", e => { mapState.detail = e.target.open; });
  $("mapToSearch").onclick = () => {
    fromSel.value = a; toSel.value = b; state.showLast = true;
    showTab("search");
    window.scrollTo(0, 0);
  };
}
function renderMap() {
  const o = opts();
  const dirName = mapState.dir === "down" ? "下り" : "上り";
  $("dirDown").setAttribute("aria-pressed", mapState.dir === "down");
  $("dirUp").setAttribute("aria-pressed", mapState.dir === "up");
  const segs = segmentLasts(NETS[state.dayType], mapState.dir, o);
  $("mapBox").innerHTML = mapSvg({ sel: mapState, segs, dirLabel: dirName });
  $("mapHint").textContent = `線の横の小さな時刻は、隣の駅まで行ける${dirName}の最終です（${state.dayType === "weekday" ? "平日" : "土休日"}・乗換余裕${o.margin}分・バス${o.busMin}分）。条件は検索画面で変えられます。`;
  renderMapResult(o);
}
function tapStation(i) {
  const m = mapState;
  if (m.a == null || m.b != null) { m.a = i; m.b = null; }
  else if (i === m.a) m.a = null;
  else { m.b = i; m.dir = i > m.a ? "down" : "up"; fromSel.value = m.a; toSel.value = m.b; }
  run();
}
function setDir(d) {
  const m = mapState;
  if (m.dir === d) return;
  m.dir = d;
  if (m.a != null && m.b != null) { [m.a, m.b] = [m.b, m.a]; fromSel.value = m.a; toSel.value = m.b; }
  run();
}
$("dirDown").onclick = () => setDir("down");
$("dirUp").onclick = () => setDir("up");
$("mapBox").addEventListener("click", e => {
  const svg = $("mapBox").querySelector("svg");
  if (!svg || !svg.getScreenCTM) return;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const i = nearestStation(p.x, p.y);
  if (i >= 0) tapStation(i);
});
$("mapBox").addEventListener("keydown", e => {
  const g = e.target.closest && e.target.closest("[data-i]");
  if (!g || (e.key !== "Enter" && e.key !== " ")) return;
  e.preventDefault();
  const i = +g.dataset.i;
  tapStation(i);
  const again = $("mapBox").querySelector(`[data-i="${i}"]`);
  if (again) again.focus();
});

showTab(state.tab);
