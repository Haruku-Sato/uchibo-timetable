# 段階7：iPhone でオフラインで使えるようにする（PWA ＋ GitHub Pages）

## 目的
iPhone のホーム画面からタップしてすぐ開き、圏外や機内モードでも検索と路線図が使えるようにする。
最初の1回だけネットで開き、以後はスマホの中に保存した版で起動する。時刻表が変わったら、ネットにつながったときに新しい版へ入れ替える。

## ビルドの出力を2つにする
- `dist/index.html`：今までどおり claude.ai アーティファクト用（skeleton なし）。**変えない**。既存のテストもそのまま通すこと。
- `site/`：PWA 用（新規）。`node build.mjs` で両方を作る。
  - `site/index.html`：`<!doctype html>`、`<html lang="ja">`、`<head>` を持つ完全な HTML。
    - `<meta charset>`
    - `<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">`
    - `<link rel="manifest">`
    - `<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">`（180×180）
    - `<meta name="apple-mobile-web-app-capable" content="yes">`
    - `<meta name="apple-mobile-web-app-title" content="内房線">`
    - `<meta name="apple-mobile-web-app-status-bar-style" content="default">`
    - `<meta name="theme-color">`（ライトとダークの2つ。media 属性で分ける）
    - アーティファクトの skeleton が担っていた次のスタイルを自分で持つ。
      - `:root` の上下の余白（safe-area）
      - `body{margin:0}`
      - `[hidden]{display:none!important}`
    - 本体（style・script）は dist と同じものを使う。
  - `site/manifest.webmanifest`
    - name「内房線 臨時ダイヤ 乗換検索」、short_name「内房線」
    - display「standalone」、start_url「./」、scope「./」
    - background_color と theme_color、icons（192・512）
  - `site/sw.js`：Service Worker。
  - `site/icons/`：アイコン（180・192・512 の PNG）。
    デザインは内房線のバッジと同じ青の地に白で「内房」。画像ファイルはビルドのスクリプトで生成するか、SVG から変換する。
    外部のツールが必要なら、何を使ったかを REVIEW.md に書く。
  - `site/.nojekyll`

## Service Worker（オフラインで速く起動するための要点）
- install の時点で、`./`・`index.html`・`manifest.webmanifest`・アイコンをキャッシュする。
- **ページの取得はキャッシュを先に使う**（cache-first）。ネットを待たずにすぐ表示するため。
  そのうえで、裏でネットから新しい版を取り、キャッシュを更新する（stale-while-revalidate）。
- キャッシュ名にビルドのバージョン（データ版＋ビルドの日時、またはハッシュ）を入れる。activate で古いキャッシュを消す。
- 新しい版を取り込んだら、次に開いたときに反映すればよい。画面には、小さく「時刻表を更新しました」と1回だけ出す。
- **フォント**：Google Fonts はオフラインでは読めない。
  PWA 版では、Google Fonts の `<link>` を残したまま、Service Worker で fonts.googleapis.com と fonts.gstatic.com の応答を実行時にキャッシュする。
  キャッシュがないとき（初回にオフラインのときなど）は、システムフォント（ヒラギノ）で表示されればよい。
  表示がフォントの読み込みを待たないように、`display=swap` を維持する。
- 画面の下の説明に、データの版（「時刻表：2026年10月時点」など）と、このアプリのビルドの日付を小さく出す。古い版で動いていないか確認できるようにする。

## GitHub Pages に公開する
- まず `gh auth status` で GitHub CLI にログインしているか確認する。ログインしていない、または gh がない場合は、作業を止めてユーザーに聞く。
- 公開リポジトリ `uchibo-timetable` を作る（すでにあれば使う）。今のリポジトリをそのまま push してよい。
  - 時刻表の画像は JR の公開資料、CLAUDE.md などは作業用のメモなので、公開して問題ない。
- `site/` を GitHub Actions で Pages に出す（`.github/workflows/pages.yml`）。
  - Actions の中で `node build.mjs` を実行してから `site/` をアップロードする。`site/` を git に入れる必要はない。
  - Pages の設定（Source を GitHub Actions にする）は、`gh api` で行う。できなければ、ユーザーに手順を伝える。
- push と公開の前に、ユーザーに確認を取ること（外部に公開する操作のため）。

## テスト（tests/run.mjs に追加）
- `site/index.html`：doctype、viewport、manifest、apple-touch-icon、apple-mobile-web-app-capable があり、Service Worker を登録している。
- `site/manifest.webmanifest`：JSON として読め、必要な項目と、実在するアイコンを指している。
- `sw.js`：構文エラーがない。キャッシュ名にバージョンが入り、install で index をキャッシュする。
- dist/index.html：今までのテストがすべて通る（アーティファクト版を壊していない）。

## REVIEW.md に書くこと
- 公開した URL と、iPhone への入れ方（Safari で開く → 共有 → ホーム画面に追加）。
- 更新の仕組み（いつ新しい版になるか）。
