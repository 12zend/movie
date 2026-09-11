# Shading 仕様書（現行機能）

## 1. 文書の位置付け

- 基準日: 2026-08-27
- 対象: `/Users/kobajin/Desktop/shading` の現行実装
- 本書でいう「現行ブロック」は、`src/lib/make-toolbox-xml.js` が生成する現在のツールボックスに表示されるブロックを指す。
- `getInfo()`、VM の primitive 登録、コンパイラー互換登録に残っているだけのブロックは、現行ブロックに含めない。
- 非表示ブロックは、既存プロジェクトの読み込み・実行・再保存に必要な範囲でのみ互換性を維持する。

現行パレットとランタイム登録は別の層である。Movie の旧 Looks ブロックと旧 Objects ブロックは読み込みのために登録されていても、現在のユーザー向け機能一覧には含めない。My Blocks Shader は削除され、Custom Shader（PenFX）がメインのシェーダー機能となる。

## 2. システム概要

Shading は Scratch VM を実行基盤とし、Movie の時間軸、Objects の描画、PenFX の合成、Three.js の 3D 描画、メディア資産管理、タイムライン書き出しを追加する。

```text
Scratch Blocks / UI
        │
        ▼
Scratch VM primitive
        │  同一 VM tick 内で状態または frame graph に記録
        ▼
MovieAssetManager ── PenFX compositor ── Pen framebuffer
        │
        └──────────── Three.js model scene / camera / lights
                                │
                                ▼
                       preview / rendered frames
                                │
                                ▼
                         MP4 / WebM / PNG / WAV
```

### 2.1 初期化責務

`src/containers/gui.jsx` は VM に次の機能を導入する。

- Movie easing (`operator_easing`)
- `MovieAssetManager`
- PenFX
- My Blocks Scene のコンパイラーと PenFX カスタムシェーダー経路

`src/containers/blocks.jsx` は Scratch Blocks 側のブロック定義、Objects のカスタム UI、PenFX のカスタム UI の動的カテゴリ登録を行う。

`src/lib/make-toolbox-xml.js` が、実際に表示するカテゴリとブロックの一次情報である。

### 2.2 MovieAssetManager

VM ごとに 1 個の `MovieAssetManager` を持つ。主な責務は次のとおり。

- タイムライン、再生・停止・シーク、キーフレーム
- ビデオ、コスチュームグループ、モデル、フォントの資産管理
- ターゲットごとの Objects 描画状態
- カメラ、ライト、モデルシーン、建築プリミティブ
- frame graph の収集・直列実行
- Pen frame transaction
- 音声イベントとレンダリングフレームの収集
- プレビューおよびファイル書き出し
- 非同期処理の状態、世代番号、キャッシュ、エラー通知

### 2.3 描画経路

- 通常のコスチューム、テキスト、ビデオは Scratch の drawable/Pen 経路を利用する。
- `objects_scene` の中でまとめられた Objects の描画は、Three.js の 1 つの深度バッファを共有する 3D シーンとして実行できる。
- 通常の Draw ノードは既存の 2D/Pen の色・画面座標セマンティクスを維持する。
- Objects の描画結果は最終的に Pen stamp として合成される。
- カメラは Draw/Scene ノードにスナップショットされ、同一 frame 中の後続変更で過去の描画結果が変わらない。

## 3. 現在表示されるブロック

### 3.1 カテゴリ構成

現在の Movie 用ツールボックスは、概ね次の順で構成される。

| 表示カテゴリ | 実装上の ID | 内容 |
| --- | --- | --- |
| Objects | `objects` | オブジェクト描画、合成、時間レポーター、ライト |
| Looks | `penfx` | PenFX。標準 Looks ではなく、PenFX の動的カテゴリ |
| Camera | `motion` | カメラ操作とカメラレポーター |
| Sound | `sound` | 現行の時間範囲音声ブロック |
| Events | `events` | `initialize`、`render frame`、通常のブロードキャスト |
| Control | `control` | Scratch の制御ブロック |
| Sensing | `sensing` | Scratch のセンシングブロック |
| Operators | `operators` | Scratch の演算子と `easing` |
| Variables | `data` | Scratch の変数・リスト |
| My Blocks | `procedures` | Scratch の通常のカスタムブロック |
| My Blocks Scene | `myBlocksScene` | `scene(vec3 p)` を定義する動的カスタムブロック |
| Pen | `pen` | ペン描画ブロック |

標準の `looks` カテゴリは現在の Movie ツールボックスでは表示しない。古い opcode の読み込み処理は別途維持する。`Pen` と `My Blocks Scene` は表示する。`My Blocks Shader` は削除され、Custom Shader（PenFX の `Import shader`）がメインとなる。

### 3.2 Objects

現行の Objects カテゴリに表示するブロックは次のとおり。

| Opcode | 表示内容・役割 |
| --- | --- |
| `objects_draw` | コスチューム、コスチュームグループ、ビデオ、テキスト、モデルを描画 |
| `objects_shape` | 多角形・星・曲線星・花形などの手続き型シェイプを描画。`objects_draw` の直下に表示 |
| `objects_arc` | 円弧を描画。`objects_draw` の直下に表示 |
| `objects_circularSegment` | 円弧セグメントを描画。`objects_draw` の直下に表示 |
| `objects_line` | 3D 座標間の線分を描画。`objects_draw` の直下に表示 |
| `objects_grouping` | サブスタックを 1 つの grouping/effects 単位として評価 |
| `objects_transform` | 位置、アンカー、回転、XYZ スケールをサブスタックへ適用 |
| `objects_composite` | 不透明度とブレンドモードをサブスタックへ適用 |
| `objects_scene` | 子 Objects を同一 3D シーン・深度バッファで評価 |
| `objects_timeWithin` | 現在時刻が指定範囲内かを返す |
| `objects_timelineTime` | Movie タイムラインの現在時刻を秒で返す |
| `objects_keyframeTime` | 1 始まりのキーフレーム番号から時刻を返す |
| `objects_leftKeyframeTime` | 2 つのキーフレーム時刻の早い方を返す |
| `objects_posterizeTime` | 時間を指定 FPS の刻みに量子化して返す |
| `objects_interpolateColor` | 2 色を時間範囲と easing で補間 |
| `objects_pass` | パス文字列を評価し、指定時刻の x/y 成分を返す |
| `looks_clearlight` | ユーザー定義ライトを全消去。opcode は旧 ID のまま |
| `looks_addpointlight` | 点光源を追加。opcode は旧 ID のまま |
| `looks_addlight` | スポット光源を追加。opcode は旧 ID のまま |

#### `objects_draw` の入力

- `SOURCE`: `costume`、`costume-group`、`video`、`text`、`model`
- `ASSET`: 資産名または Objects UI が生成する資産選択値
- `TEXT`: テキスト描画時の文字列
- `VIDEO_MODE`: ビデオのフレーム列再生またはタイムライン連動再生
- `FRAME`: ビデオまたはモデルのフレーム番号
- `SPEED`: ビデオ再生速度
- `VOLUME`: オブジェクトビデオの音量
- `PX`、`PY`、`PZ`: ワールド位置。既定値は `0, 0, 480`
- `RX`、`RY`、`RZ`: 回転角
- `SX`、`SY`、`SZ`: XYZ スケール。既定値は `1, 1, 1`
- `SIZE`: Scratch サイズ相当の倍率。既定値は `100`
- `WIDTH`、`HEIGHT`: 平面の幅・高さ倍率。既定値は `100, 100`
- `T1`、`T2`: 描画する時間範囲。既定値は `0` から無限大

資産名が見つからない場合は、セレクターの実装に従って最初の資産へフォールバックする。描画対象が時間範囲外なら、その frame では描画しない。

#### Objects の合成規則

- `objects_grouping` の子ブロックは、現在の frame の 1 つのグループとして収集する。
- `objects_transform` は位置、アンカー、回転、スケールを親から子へ累積する。
- `objects_composite` の不透明度は 0〜100 % を 0〜1 に変換する。
- ブレンドモードは `normal`、`add`、`mul`、`screen`、`overlay`、`darken`、`lighten`、`color dodge`。
- `objects_scene` は Objects の子描画を Three.js シーンへ集約し、同じ深度バッファで前後関係を決める。
- Scene 外の通常 Draw は既存の Scratch/Pen 経路で描画する。

### 3.3 Camera

`motion` カテゴリは表示名が `Camera` に変更されている。現行の表示ブロックは次のとおり。

#### コマンド

`motion_setcamerato`、`motion_setcamerax`、`motion_setcameray`、`motion_setcameraz`、
`motion_changecameraxby`、`motion_changecamerayby`、`motion_changecamerazby`、
`motion_setcamerarotation`、`motion_changecamerarotationby`、
`motion_setcamerarotationorder`、`motion_setfov`、`motion_lookat`

#### レポーター

`motion_camerax`、`motion_cameray`、`motion_cameraz`、
`motion_camerarotationx`、`motion_camerarotationy`、`motion_camerarotationz`、
`motion_camerarotationorder`、`motion_fov`、`motion_focallength`

カメラの既定値は位置・回転が 0、回転順序が `XYZ`、FOV が約 `53.13` 度である。FOV と焦点距離は相互変換され、FOV は `0.001`〜`179.999` 度の範囲に正規化する。回転順序は Three.js が扱う 6 種類を使用する。

### 3.4 Sound

現在の Sound カテゴリに表示する Movie 専用ブロックは `sound_playattime` だけである。

```text
play [sound] from [T1] to [T2] sec
speed [SPEED] volume [VOLUME] %
```

- `T1`、`T2` はタイムライン上の開始・終了時刻。
- `SPEED` は正数以外を `1` に補正する。
- `VOLUME` は 0〜100 % にクランプする。
- 再生中は同じブロックを frame ごとに再起動せず、同じ音源の再生状態を継続する。
- 一時停止中の `event_renderframe` 再評価はスクラブ用のため無音にする。ブロックを直接クリックした場合の試聴は許可する。
- 書き出し中は frame ごとの音声イベントとして収集し、速度、音量、パン、ピッチを反映する。

### 3.5 Events

- `event_initialize`: タイムライン書き出し開始時の初期化処理。既存スレッドを再起動する。
- `event_renderframe`: プレビューまたは書き出し対象の各 frame を構築するカスタム hat。既存スレッドを再起動する。
- `event_whenbroadcastreceived`、`event_broadcast`、`event_broadcastandwait`: 通常の Scratch ブロードキャスト。

`event_renderframe` はコマンドブロックではない。`runtime.startHats('event_renderframe')` の呼び出しは、hat 本体の実行を同期的に進める場合があり、呼び出し自体が VM の yield を作るとは限らない。

### 3.6 Operators

通常の Scratch 演算子に加え、現行の表示ブロックとして `operator_easing` を持つ。

```text
easing [TYPE] [TYPE2] value [V0] ~ [V1] time [T0] ~ [T1]
power [POWER] speed [SPEED] strength [STRENGTH]
```

`TYPE` は `PowerIn`、`PowerOut`、`PowerInOut`、`CircIn`、`CircOut`、`CircInOut`、`ExpoIn`、`ExpoOut`、`ExpoInOut`。`TYPE2` は `Elastic` または `Bounce` で、一次 easing に二次エフェクトを加える。`POWER` は一次 easing の指数、`SPEED` は二次エフェクトの速度、`STRENGTH` は二次エフェクトの強度を指定する。`STRENGTH` が 0 なら二次エフェクトは無効。時間が開始前なら `V0`、終了後なら `V1`、範囲内なら選択した easing で補間する。`T1 <= T0` の場合は、開始時刻より前なら `V0`、それ以外なら `V1` を返す。

Objects の色補間などが使う共通 animation vocabulary には `Linear`、`BackIn`、`BackOut`、`BackInOut` も含まれる。

## 4. PenFX

PenFX は `penfx` extension として登録され、ツールボックス上では `Looks` と表示する。標準 Looks カテゴリとは別の機能である。

### 4.1 現行 UI

- `Import shader` ボタンから shader package を読み込む。
- 起動時に組み込み package `penfx-builtins` を登録する。
- 組み込み package は 59 ブロック、26 fragment program。
- package ごとにラベルとブロックを追加し、外部 package のブロックは package 固有 opcode を使う。
- `set-blend-mode` で PenFX の合成モードと opacity を指定できる。

組み込みブロックの ID は次のカテゴリに分かれる。

| 分類 | ブロック ID |
| --- | --- |
| 色・階調 | `contrast`, `brightness`, `gamma`, `saturation`, `alpha`, `color-grade`, `color-blindness`, `color-space-adjust`, `tone-map`, `auto-exposure`, `palette-swap`, `chroma-key`, `color-overlay`, `gradation-overlay` |
| 描画・ぼかし・形状 | `stroke`, `blob`, `rgb-shift`, `gaussian-blur`, `directional-blur`, `radial-blur`, `lens-blur`, `depth-of-field`, `fog`, `lens-distortion`, `bloom`, `deep-glow`, `edge-detection`, `sharpen`, `fxaa`, `difference-of-gaussians`, `kuwahara`, `chromatic-aberration`, `film-grain`, `dither`, `halftone`, `ascii`, `crt`, `vhs`, `glitch`, `vignette` |
| 合成・変形・バッファ | `composition`, `framing`, `zoom`, `wavy`, `fractalnoise`, `pulse`, `pixelate`, `pixel-stretch`, `mirror`, `transform`, `duplicate`, `pixel-sort`, `color-adjustment`, `displacement-map`, `stack-current-drawing`, `render-buffer-stack`, `clear-buffer-stack`, `buffer-stack-size`, `set-blend-mode` |

### 4.2 PenFX 実行契約

- PenFX の通常ブロックは VM primitive の視点では同期的に処理する。
- package の展開、GLSL の compile/link、program 登録などの遅い処理は `runWithoutWaiting` で開始する。
- package の初期化・検証で VM primitive から Promise を返さない。
- PenFX が Objects のグループ、render pass、matte、frame graph 内で呼ばれた場合は、その位置を保ったまま frame graph に収集する。
- frame 外の直接実行でも、GL state を保存・復元して後続の Scratch 描画へ影響させない。
- 色は premultiplied alpha を前提とする。GLSL で RGB を処理する場合は必要に応じて straight color に戻し、出力時に alpha を掛け直す。
- `u_time` と `u_frame` は実時間ではなく Movie タイムライン由来であり、同じ frame では同じ値になる。

### 4.3 Custom shader package

詳細な package 形式、manifest、GLSL 制約、version 2 adapter、サイズ制限は [`PENFX_SHADER_PACKAGES.md`](/Users/kobajin/Desktop/shading/docs/PENFX_SHADER_PACKAGES.md) を正とする。

要点は次のとおり。

- format は `shading.app/penfx-shader`。
- version 1/2 を使用する。
- 1 package のブロック数は 1〜64、1 ブロックの input 数は最大 24。
- zip は最大 10 MB、展開後の shader 合計は最大 2 MB、1 shader は最大 512 KB、package 内 shader 合計は最大 4 MB。
- GLSL は WebGL 1 の GLSL ES 1.00 fragment shader。
- 任意の JavaScript は実行できない。
- version 2 adapter は既定 PenFX が公開する implementation opcode に限る。
- compile/link に失敗した package は登録しない。
- package のソースは `.shade` プロジェクト内の `penFXShaders` に保存できる。組み込み package は重複保存しない。

## 5. タイムライン

### 5.1 設定

| 設定 | 既定値 | 正規化 |
| --- | ---: | --- |
| duration | 10 秒 | 0.1〜3600 秒。無効値は 10 秒 |
| framerate | 30 fps | 1〜120 fps |
| width / height | ステージサイズ | 設定 UI では各 1〜4096 px。読み込み時の下限は 1 px |
| rangeStart | 0 秒 | 0〜duration |
| rangeEnd | duration | rangeStart〜duration |
| exportFormat | `mp4` | `mp4`、`webm`、`png-sequence`、`png-frame`、`audio-wav` |
| reuseFrames | `true` | false のときキャッシュを使わない |

タイムラインのシリアライズ項目は `duration`、`exportFormat`、`framerate`、`height`、`keyframes`、`rangeEnd`、`rangeStart`、`reuseFrames`、`sound`、`width`。

### 5.2 UI 操作

タイムライン UI は次を提供する。

- 再生、ポーズ、停止
- 時刻のスクラブ
- キーフレームの追加・削除
- frame 単位の前後移動、先頭・末尾移動
- タイムライン表示のズーム
- 720p preview、1080p final、4K final のプリセット
- 書き出し範囲、解像度、FPS、形式、frame 再利用の設定

現行プリセットは次のとおり。

| プリセット | FPS | 出力サイズ |
| --- | ---: | ---: |
| Preview 720p | 24 | 1280×720 |
| Final 1080p | 30 | 1920×1080 |
| Final 4K | 30 | 3840×2160 |

### 5.3 再生

- `play` は現在時刻が duration 以上なら 0 秒へ戻し、音声と VM の実行を再初期化する。
- `pause` は実時間から現在時刻をサンプルし、音声、実行スレッド、プレビューサイズを停止・復元する。
- `stop` は 0 秒へ戻し、未完了の書き出しをキャンセルする。
- `seek` は再生状態を維持したまま指定時刻へ移動し、次の frame を再評価する。
- 再生中の `event_renderframe` は実時間に基づく。書き出し中の `event_renderframe` は `renderFrameIndex / framerate` で決まる決定的な時間を使う。

### 5.4 frame 生成トランザクション

1. 書き出し開始時に既存の音声、保留中の描画、VM 実行を停止する。
2. 必要ならレンダラーを出力サイズへ変更し、`event_initialize` を開始する。
3. 初期化用スレッド、資産読み込み、保留中のビジュアル処理が終わるまで内部状態で待つ。
4. frame ごとに frame graph を開始し、決定的なタイムライン時刻を設定する。
5. Pen を透明な staging frame へ切り替え、既定背景を描画する。
6. `event_renderframe` を起動する。
7. frame graph、Objects 描画、ビデオ frame、テキスト、モデル、PenFX の保留処理を完了させる。
8. 音声イベントを確定し、Pen frame を commit してから frame を保存する。
9. 次の frame index へ進む。終了時刻に達したらプレビューサイズを復元し、完了イベントを通知する。

### 5.5 キーフレーム

- キーフレームは 0〜duration にクランプし、昇順に並べる。
- `1e-9` 以下の差は同じ時刻として重複排除する。
- `objects_keyframeTime` は 1 始まりの ID を範囲内へクランプする。
- 小数 ID は隣接キーフレーム間を線形補間する。
- キーフレームがない場合の時刻は 0。
- `objects_leftKeyframeTime` は 2 つの結果の小さい方を返す。

## 6. frame graph と原子性

### 6.1 frame graph

frame graph は Scene、Draw、Group、Composite、Transform ノードで構成される。連続する scene mutation は対象と camera version が同じ場合にバッチ化する。flush は非同期で直列実行され、古い世代の描画結果は世代番号で無効化できる。

### 6.2 VM tick の契約

- 新規または変更する Movie command block は、Scratch VM に Promise を返さない。
- 非同期処理は `MovieAssetManager.runWithoutWaiting` で開始する。
- 非同期処理の完了待ちは VM のブロック待ちではなく、タイムラインの内部状態 (`pending visual render`、`blocking video render`、frame graph promise など) で管理する。
- `erase all`、render block、`stamp` の間に VM yield を入れない。
- 描画、マテリアル登録、テクスチャ設定はループ内で呼ばれても中間状態を表示しない。
- `add material` は同名既存リソースを毎回初期化せず、冪等に扱う。
- デコード済み資産キャッシュと scene/material state は分離する。再適用時にフォールバック画像を一瞬表示しない。
- frame reset は `BEFORE_EXECUTE` / `AFTER_EXECUTE` hook から直接 `pen_clear` を呼ばず、同じ render-frame transaction の中で行う。
- renderer の global `draw` 抑制でタイミング問題を隠さない。

`looks_rendervideo` の exact-frame primitive は、旧プロジェクトが直後の `stamp` で要求 frame を消費できるよう、内部で blocking video render として追跡する既存互換例外である。新規 command block の一般的な待機方式ではない。

### 6.3 Pen frame transaction

- `pen_clear` は frame graph 収集中なら clear ノードとして記録する。
- `pen_stamp` は stamp ノードとして記録する。
- `resetPenForRenderFrame` は staging frame を開始し、既定背景を描画する。
- render-frame 本体と保留中の visual work が完了するまで staging frame を commit しない。
- そのため、frame の途中で透明な空画面が露出したり、`erase all` 後の空白 frame が flicker したりしない。
- 停止、シーク、エラー、世代変更時は transaction を commit せず cancel する。

## 7. 3D、モデル、ライト

### 7.1 現行ユーザー経路

- Camera カテゴリでカメラを操作する。
- Objects の `draw` で `model` 資産を選択し、位置・回転・スケール・frame を指定する。
- Objects の `scene` で複数のモデル／オブジェクトを同じ深度バッファにまとめる。
- Objects カテゴリに表示される 3 つのライトブロックで点光源・スポット光源を設定する。
- Model タブでモデルの追加、プレビュー、モーション／ポーズの選択を行う。

### 7.2 モデル資産

入力可能なモデル形式は `glb`、`pmx`、`fbx`、`obj`。OBJ の場合は対応する MTL とテクスチャを同時に扱う。PMX はモデルフォルダのテクスチャを解決する。読み込み後は内部で統一された GLB 資産として保持する。

モーション形式は `vmd` と `vpd`。

- VMD はリグ／ボーンを持つモデルに対して 30 fps で再サンプリングする。
- VPD は 1 frame のポーズとして扱う。
- モーション追加後はモデル資産の active motion と motion 一覧を更新する。
- `objects_draw` の `FRAME` はモデル animation の frame として使用する。

モデルは表示用に中心位置を正規化し、最大寸法を基準サイズへ合わせる。モデルの GPU オブジェクトは asset ID 単位でキャッシュし、削除・置換時に破棄する。

### 7.3 カメラとライトの既定

- ステージ既定サイズは 480×360。
- 既定 focal length はステージ幅を基準に計算する。
- `lights === null` は後方互換の studio light を選択する。
- ユーザーがライトを 1 つ追加すると authored light scene へ切り替わり、その後はライトを累積する。
- `looks_clearlight` は authored light scene を空にする。
- 点光源の shadow map は 256、スポット光源は 512、遠方距離は 10000 を基本とする。

## 8. メディア資産

### 8.1 対応形式

| 資産 | 拡張子 |
| --- | --- |
| コスチューム | `svg`, `png`, `bmp`, `jpg`, `jpeg`, `jfif`, `webp`, `gif`, `exr` |
| サウンド | `wav`, `mp3`, `ogg`, `oga`, `flac`, `aac`, `m4a` |
| フォント | `ttf`, `otf`, `woff`, `woff2` |
| モデル | `glb`, `pmx`, `fbx`, `obj` |
| モーション | `vmd`, `vpd` |
| ビデオ | `mp4`, `webm`, `ogv`, `mov` |

### 8.2 ビデオ

- 内部 video frame rate は 30 fps 固定。
- frame `n` の media time は `(n - 1) / 30` 秒。
- frame は動画の長さに応じてクランプし、末尾では `duration - 0.001` 秒を上限とする。
- 受け付けた frame request は順序を維持して処理する。連続 request を勝手に collapse しない。
- モード変更または対象削除時に stale request を無効化する。
- video bitmap の解像度はステージ／書き出しサイズの最大 2 倍を基本上限とする。
- オブジェクトビデオの `video` モードは Movie timeline に同期し、別の video element と音声再生を持つ。

### 8.3 テキストとフォント

- フォントは runtime font manager に登録する。
- 組み込みフォントは Sans Serif、Serif、Monospace。
- テキストは 96 px の canvas に描画し、行間は約 1.2 倍、padding は 16 px。
- canvas の最大辺は 4096 px。
- テキスト canvas cache は最大 128 エントリ、または約 16M pixel を上限とする。
- 未ロードフォントはバックグラウンドでロードし、ブロック primitive はロード完了まで VM を待たせない。

## 9. レンダリングと書き出し

### 9.1 出力形式

| 形式 | 内容 |
| --- | --- |
| `mp4` | MediaRecorder による動画。対応 codec は実行環境で選択 |
| `webm` | 透明背景を保持できる WebM。対応 codec は実行環境で選択 |
| `png-sequence` | `frame-XXXX.png` の ZIP。frame error があれば `render-errors.json` も含む |
| `png-frame` | 現在時刻の 1 frame PNG |
| `audio-wav` | timeline 音声のみの WAV |

UI からの `renderAndExportTimeline` は UI 用の非同期 API であり、Scratch の command primitive の戻り値契約とは別である。レンダリング完了・キャンセル・エラーイベントを待ってからエンコードを開始する。

### 9.2 音声エンコード

- 音声は Web Audio の BufferSource として frame／clip から構築する。
- playback rate、offset、duration、volume、pan、pitch を反映する。
- 同時発音の合計音量が 1 を超える場合、音色とダイナミクスを変えない定数 gain で全体を縮小する。
- encoder 前の master gain は `0.8912509381337456`（-1 dBFS headroom）を基本値とする。

### 9.3 frame cache

- cache key は render cache generation、width、height、framerate、frame index で構成する。
- timeline 設定またはプロジェクト変更時は generation を進め、古い frame cache と音声 event cache を破棄する。
- `reuseFrames` が有効な場合、変更されていない frame と対応する音声イベントを再利用する。
- 出力範囲を指定した場合、`rangeStart` から `rangeEnd` までを含む frame を処理する。

## 10. プロジェクト形式

### 10.1 拡張子と marker

| 用途 | 拡張子／marker |
| --- | --- |
| Movie/Shading プロジェクト | `.shade`、内部 marker `mb3` |
| 互換 Movie 拡張子 | `.mb3` |
| 通常 Scratch プロジェクト | `.sb3` |
| 読み込み互換 | `.sb2`、`.sb` |

Movie 機能が検出された runtime は保存時に `.shade` を選択する。Movie feature がない通常プロジェクトは `.sb3` を選択する。

Movie プロジェクトの marker は次の形で保存する。

```json
{
  "mb3": {
    "version": 1,
    "features": ["movie-blocks", "timeline"]
  }
}
```

`features` は検出された機能をソートして保存する。候補は `movie-blocks`、`pen-fx`、`my-blocks-scene`、`3d-engine`、`graphic-effects`、`video-assets`、`costume-groups`、`model-assets`、`timeline`、`pen-fx-shaders`。

### 10.2 保存データ

MovieAssetManager が扱う主要な project JSON key は次のとおり。

- `movieVideos`
- `movieCostumeGroups`
- `movieModels`
- `movieCamera`
- `movie3D`
- `movieTimeline`
- `penFXShaders`

プロジェクト読み込み時は marker だけに依存せず、block opcode と asset key から Movie feature を再検出できる。これにより marker がない旧ファイルも Movie プロジェクトとして扱える。

### 10.3 保存の安全性

デスクトップ版の保存は、一時ディレクトリへ書き込み、flush・sync 後に対象ファイルへ置換する。置換に失敗した場合は元ファイルを復元し、保存途中の内容で元ファイルを切り詰めない。

## 11. デスクトップ版

- Electron はブラウザー版と同じ `build` 出力を使用する。
- ローカルの安定した localhost origin からアプリを配信し、ブラウザー版とプロジェクト形式・IndexedDB の互換性を保つ。
- プロジェクトファイルの関連付けは `.shade`、`.mb3`、`.sb3`、`.sb2`、`.sb`。
- 起動時のファイル指定、OS の open-file、ファイル picker を同じ読み込み経路へ集約する。
- 未保存変更がある状態で閉じる場合は確認を行う。
- macOS では明示的な GPU スイッチがない限り ANGLE Metal backend を使用する。
- `--use-gl`、`--use-angle`、`--disable-gpu` などの明示的な起動指定は尊重する。
- パッケージングでは macOS の `.app` 向けターゲットに加えて、Windows の NSIS インストーラー `.exe` と portable `.exe` を生成する。

開発・パッケージングの主なコマンドは次のとおり。

```sh
npm ci
npm run build:desktop
npm run electron:start
npm run electron:dev
npm run package:desktop
npm run package:desktop:dir
```

## 12. 互換性専用の非表示ブロック

この節の opcode は、現在のツールボックスに表示する機能ではない。`getInfo()`、primitive、compiler compatibility、project format の検出に残っている場合があっても、現行機能として新規利用することを前提にしない。

### 12.1 Objects の非表示ブロック

#### 旧アニメーション／カーブ系

`objects_animate`、`objects_loopValue`、`objects_pingPongValue`、`objects_wiggle`、
`objects_interpolateAngle`、`objects_interpolateVector`、`objects_numberCurve`、
`objects_colorCurve`、`objects_angleCurve`、`objects_stepCurve`、
`objects_instanceId`、`objects_instanceSeed`

特に `objects_animate` は実装上の評価関数を残しているが、現行パレットには表示しない互換性専用ブロックである。

#### 旧合成・時間制御

`objects_group`、`objects_simulation`、`objects_matte`、`objects_renderPass`、
`objects_drawPass`、`objects_clearPass`、`objects_repeat`、`objects_timeOffset`、
`objects_timeRange`、`objects_timeScale`、`objects_timeLoop`、`objects_timeFreeze`、
`objects_timeReverse`、`objects_timeRemap`

### 12.2 旧 Movie Looks／Sound opcode

標準 Looks カテゴリを表示しないため、次の Movie opcode は旧プロジェクトのロード・実行用である。

- `looks_switchvideoto`、`looks_setvideoframeto`、`looks_changevideoframeby`
- `looks_settextfont`
- `looks_clearscene`、`looks_clearmaterial`、`looks_addmaterial`
- `looks_setalbedofromcolor`、`looks_setalbedofromtexture`
- `looks_setemissionfromcolor`、`looks_setemissionfromtexture`
- `looks_setdisplacementmap`、`looks_setnormalmap`、`looks_setroughmap`
- `looks_setmodelframeto`、`looks_rendermodel`、`looks_renderwall`、`looks_renderfloor`、`looks_renderbox`
- `looks_switchmodelto`
- `looks_addrenderingframe`、`looks_clearrenderingframe`、`looks_exportrenderingmp4`
- `sound_playatframe`

`looks_clearlight`、`looks_addpointlight`、`looks_addlight` は旧 opcode を使用するが、現在は Objects カテゴリに表示するため、互換性専用一覧からは除外する。

`looks_rendervideo` は旧 exact-frame 描画のために残り、直後の stamp が正しい video frame を消費できるよう内部で blocking render として扱う。

### 12.3 My Blocks Scene

My Blocks Scene は `myBlocksScene` カテゴリとして My Blocks の直下に表示する。Scene の定義は `myblocksscene_return` の条件と RGB を、内蔵 `scene.frag` の `vec3 scene(vec3 p)` 関数へコンパイルする。条件には Scratch の全標準演算ブロックを使用でき、条件が true の点は RGB を返して塗りつぶし、false の点は `vec3(0.0)` を返して空洞にする。`p x`、`p y`、`p z` はワールド空間の `p.x`、`p.y`、`p.z` を返す。

内蔵フラグメントシェーダーのレイマーチャーは PenFX の既存 custom shader 登録・描画経路でレンダリングする。レイの原点には MovieAssetManager の Camera 位置を使い、`v_uv` から作った方向ベクトルを Scratch の座標系（+Y が上）へ変換してから Camera の回転順序で回転し、レイを生成する。Scene の GLSL は元の `scene.frag` と Three.js に合わせて -Z 前方の基底を使うため、Camera の位置と回転は Movie の +Z 前方の基底から境界で変換する。横幅のアスペクト比は実際の描画先の `u_resolution` から求めるため、フルスクリーンや書き出し時も画面幅に合う。Scene 式の未占有点は alpha 0 の透明な寄与として、既存の Pen／Shader レイヤーへ source-over 合成するため、黒い背景を塗らない。

Scene の式は固定のワールド空間ボックスで切らない。したがって `px < -1` や `px > 1` のような条件は、x 方向に無限に続く形として評価される。通常の物体は近距離を高密度に、無限平面などは遠距離を対数間隔に探索する。空のレイを GPU 上で無限ループにしないための数値上の終端距離は設けるが、`p.x`、`p.y`、`p.z` 自体を ±1.5 などの箱へクランプするものではない。

Scene の固定ライトは持たない。`lights === null` のときは Objects の studio lighting、`looks_addpointlight`／`looks_addlight` または `looks_clearlight` 実行後は Objects と同じ authored light 配列を使い、位置、色、強度、半径、スポット角、影の強さを Scene のライティング uniform へ渡す。

## 13. 実装上のエラーと状態管理

- 非同期資産の失敗は VM を Promise 待ちにせず、MovieAssetManager の render error／diagnostics 経路へ通知する。
- 対象削除、停止、シーク、プロジェクト変更、render cache generation の更新時は、対象に紐づく古い queue と bitmap を無効化する。
- テクスチャは decode 完了後に generation と対象 state を検証し、古い request が新しい material を上書きしない。
- モデル、ビデオ、テキストの queue は対象ごとに直列化する。
- `event_renderframe` の script が保留中でも、同じ frame を再起動して時間を進めない。保留処理完了後に既存 thread を継続する。
- 書き出し中の frame エラーは `renderingFrameErrors` に frame、時刻、message を保存し、PNG sequence では `render-errors.json` として出力できる。
- PenFX の compile/render エラーは GL state を復元して後続描画を保護する。

## 14. 仕様の一次ソース

| ファイル | 仕様上の責務 |
| --- | --- |
| `src/lib/make-toolbox-xml.js` | 現行ツールボックスのカテゴリと表示ブロック |
| `src/lib/object-blocks.js` | Objects の登録、primitive、入力、互換 opcode |
| `src/lib/object-blocks-ui.js` | Objects の資産選択・モデル・ビデオ UI |
| `src/lib/movie-asset-manager.js` | MovieAssetManager の状態と初期化 |
| `src/lib/movie-asset-manager-primitives.js` | Movie primitive と VM scheduling 契約 |
| `src/lib/movie-asset-manager-frame-graph.js` | frame graph、camera snapshot、Pen transaction |
| `src/lib/movie-asset-manager-timeline.js` | timeline state、再生、書き出し frame lifecycle |
| `src/lib/movie-asset-manager-media.js` | ビデオ、フォント、コスチューム、テキスト |
| `src/lib/movie-asset-manager-assets.js` | モデル、モーション、資産 cache |
| `src/lib/movie-asset-manager-object.js` | Objects の描画と scene capture |
| `src/lib/movie-asset-manager-render-export.js` | MP4、WebM、PNG、WAV のエンコード |
| `src/lib/movie-asset-manager-sound-export.js` | timeline 音声イベントと export orchestration |
| `src/lib/project-format.js` | `.shade`、`mb3` marker、Movie feature 検出 |
| `src/lib/pen-fx/core.js` | PenFX runtime と合成 transaction |
| `src/lib/pen-fx/custom-shaders.js` | shader package の検証・登録・保存（Custom Shader がメイン） |
| `src/lib/my-blocks-scene.js` | My Blocks Scene compiler、内蔵 `scene.frag` への関数合成、PenFX custom shader 実行 |
| `src/lib/my-blocks-scene-blocks.js` | My Blocks Scene の Blockly 定義、カテゴリ、procedure mutation |
| `src/lib/model-runtime.js` | Three.js model、camera、light、depth rendering |
| `electron/main.js`、`electron/file-store.js`、`electron/graphics.js` | デスクトップ起動、保存、GPU backend |

関連する検証コードは `test/unit/util/movie-project-roundtrip.test.js`、`test/unit/util/pen-fx-custom-shaders.test.js`、`test/unit/util/object-blocks.test.js`、`test/unit/util/movie-asset-manager.test.js`、`test/unit/components/timeline.test.jsx` にある。
