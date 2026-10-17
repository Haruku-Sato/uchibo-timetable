/* ===== Service Worker（PWA 版だけで使う）=====
 * ページと自分のファイル：キャッシュを先に返し（すぐ起動する）、裏でネットから取り直してキャッシュを更新する（stale-while-revalidate）。
 * Google Fonts：実行時にキャッシュする。なければシステムフォントで表示される（CSS 側の display=swap）。
 * __VERSION__ は build.mjs が中身のハッシュに置き換える。版が変わると新しいキャッシュを作り、古いキャッシュは activate で消す。
 */
const VERSION = "__VERSION__";
const CACHE = "uchibo-" + VERSION;
const FONT_CACHE = "uchibo-fonts"; // フォントは版をまたいで使い回す
const CORE = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", event => {
  // HTTP キャッシュを使わず、必ずネットから最新を取る
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("uchibo-") && k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) { event.respondWith(fromCacheThenNetwork(event, FONT_CACHE, req)); return; }
  if (url.origin !== self.location.origin) return;
  // ページの表示は、クエリなどが付いていても index.html のキャッシュを使う
  event.respondWith(fromCacheThenNetwork(event, CACHE, req.mode === "navigate" ? "index.html" : req));
});

/* キャッシュにあればすぐ返し、裏でネットから取り直して更新する（取り直しが終わるまで SW を止めない）。なければネットを待つ */
async function fromCacheThenNetwork(event, cacheName, key) {
  const req = event.request;
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key, { ignoreSearch: req.mode === "navigate" });
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === "opaque")) cache.put(key, res.clone());
    return res;
  }).catch(() => null);
  event.waitUntil(net);
  if (hit) return hit;
  const res = await net;
  return res || new Response("オフラインのため読み込めませんでした", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
