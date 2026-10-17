/* ===== PWA 版だけで使う：Service Worker の登録と「時刻表を更新しました」の表示 =====
 * __VERSION__ は build.mjs が置き換える。前回開いたときと版が違えば、1回だけ小さく知らせる。
 */
(function () {
  var v = "__VERSION__", prev = null;
  try { prev = localStorage.getItem("uchibo-app-version"); localStorage.setItem("uchibo-app-version", v); } catch (e) { /* 使えなくても動く */ }
  if (prev && prev !== v) {
    var t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = "時刻表を更新しました";
    document.body.appendChild(t);
    setTimeout(function () { t.hidden = true; }, 4000);
  }
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
})();
