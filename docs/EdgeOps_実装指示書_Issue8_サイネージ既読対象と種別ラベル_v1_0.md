# EdgeOps 実装指示書 ── Issue⑧：サイネージの既読対象・時刻表現・種別ラベル（第151回）

**版数**：v1.0
**作成**：2026年7月24日（金）／ Claude（設計・起案）
**根拠**：EO-DEC-0151（第151回・条件付きGO／論点1=A・論点2=A・論点5=A／論点4は現状維持）
**正本**：サイネージ機能 仕様書 v2.4 第15章・第16章
**宛先**：GitHub Copilot（PR実装）

---

## 0. この指示書の使い方

**本書だけを読んで実装できるように書いてある。** 第1章（変更対象ファイル）と第2章（変更禁止領域）を先に読むこと。

**本件はすべて `signage.html` の表示に関する変更である。DB・RPC・Policy・GRANT・既読集計ロジック本体・`signage-fetch` には一切触れない。**

---

## 1. 変更対象ファイル

| # | ファイル | 現在の行数 | 変更の可否 |
|---|---|---|---|
| 1 | **`signage.html`** | **2,324行** | **変更する（唯一の対象）** |

### 変更してはならないファイル（明示）

| ファイル | 理由 |
|---|---|
| **`supabase/functions/signage-fetch/index.ts`** | **第151回判定により変更禁止。** 2026/7/6 の誤検知事故の当該箇所であり、慎重に扱う |
| `index.html` | 本Issueの対象外。スマートフォン側は既に正しく動作している |
| `js/i18n.js` | **`signage.html` は `js/i18n.js` を読み込まない**（分割定義仕様書 第3章）。文言は `signage.html` 内に直接記述する |
| `js/ui-helpers.js` ほか `js/` 配下 | 同上。`signage.html` は `js/` 配下を読み込まない |
| `styles.css` | `signage.html` は `styles.css` を参照していない（`<style>` インライン） |
| SQL・RPC・RLS Policy・GRANT | **本Issueに DB変更は無い** |

**新規ファイルを作成しないこと。**

---

## 2. 変更禁止領域（絶対保護）

```
【不可侵・変更禁止】
- token認証・token復元・エラーコード判定（allowlist方式）
- サイネージ無効画面への遷移条件
- 5分間隔のポーリング・深夜3時のリロード・60秒認証リトライ
- Fully Kiosk 関連の処理
- 既読集計ロジック本体（L1690〜L1730）
  ※ humanMembers の抽出条件・rosterMembers の決定・readUids の算出に
    一切触れない。今回の原因は集計式ではなく、openModal へ渡す対象IDである
- item_receivers の参照ロジック（L1708〜L1715・EO-DEC-0125）
- 引き継ぎ表示処理・アンケート表示処理
- 天気・熱中症指数（WBGT）・祝日・参加用QR・カスタムLINK
- 投稿グループの組み立て（buildPostGroups 相当・L1518〜L1557）
- 並び順（messageItems.sort・L1564〜L1566／最新活動日時の降順）
- 縦帯の色・CSSクラス名（priority-urgent / priority-normal / priority-info）
- itemCls / order の値
- messages.priority の値
- getHandoverLabel() の確認状態の判定ロジック（_confirmed / _fullyConfirmed）
- CSSの変更全般
```

**★特に注意：** 2026/7/6 に「サーバー側の一時障害を token 無効と誤判定して停止する」事故が発生している（学び98）。**エラー分類には新しい分類を追加しない。既存分類の判定条件も変更しない。**

---

## 3. 変更箇所（4箇所）

**第151回判定で明示的に許可された箇所のみ。**

| # | 関数・定義 | 行 | 変更内容 |
|---|---|---|---|
| ① | `openModalByIndex()` | L1638 | `openModal` へ渡す引数 |
| ② | `buildItemHtml()` | L1251 | 「最新活動」→「送信」 |
| ③ | `msgPriorityMap` | L1417〜L1419 | `label` 文字列 |
| ④ | `getHandoverLabel()` | L1385〜L1392 | `label` 文字列 |

**この4箇所以外に手を入れないこと。** これを超える変更が必要になった場合は、実装を止めて報告すること。

---

## 4. 修正内容

### 4-1 【修正①】モーダルに最新返信の情報を渡す（論点1）

**現状（L1638）：**

```js
openModal(item.body || '', p.label, p.cls, timeStr, item.id, item._type, item.sender_eo_uid || '', item.created_at || null, groupInfo);
```

投稿グループの `item` は**元投稿**であるため、モーダルは元投稿の既読を表示していた。

**修正後：**

```js
// 投稿グループの場合、既読・未読名簿は最新返信のものを表示する（EO-DEC-0151）
const modalTarget = item._latestReply || item;
openModal(item.body || '', p.label, p.cls, timeStr, modalTarget.id, item._type, modalTarget.sender_eo_uid || '', modalTarget.created_at || null, groupInfo);
```

**要点：**

- **`_latestReply` があれば最新返信、無ければ従来どおり `item`** を使う（第151回の条件）
- 差し替えるのは **`id` / `sender_eo_uid` / `created_at` の3つだけ**
- **`item.body` は差し替えないこと。** モーダルの本文は `groupInfo` 経由で組み立てられるため、第1引数は現状のまま `item.body` を渡す
- **`p.label` / `p.cls` は差し替えないこと。** 縦帯の色は元投稿の priority を使う（第149回・第150回で確定済み）
- **`item._type` も差し替えないこと**
- `_latestReply` は `messages` の行そのものであり（L1547）、`id`・`sender_eo_uid`・`created_at` を持つ

**★ `openModal()` の中身（L1641以降）には一切触れないこと。** 既読集計ロジックは正しく実装されている。

### 4-2 【修正②】時刻の表現を「送信」に揃える（論点2）

**現状（L1251）：**

```js
<div class="message-time">${timeStr} 最新活動${isLong ? '　<span style="font-size:10px; color:rgba(255,255,255,0.3);">タップで全文表示</span>' : ''}</div>
```

**修正後：** `最新活動` を `送信` に置き換える。

```js
<div class="message-time">${timeStr} 送信${isLong ? '　<span style="font-size:10px; color:rgba(255,255,255,0.3);">タップで全文表示</span>' : ''}</div>
```

**要点：**

- **文言のみの変更である。** `timeStr` の算出（L1231〜L1236・最新活動日時を使う処理）は**変更しない**
- 「タップで全文表示」の部分・`isLong` の判定・スタイルは変更しない
- **相対表記（「8分前」等）にしないこと。** サイネージは5分ポーリングのため不適切である（第151回で明示的に不採用）

### 4-3 【修正③】連絡の種別ラベルをスマートフォンに揃える（論点5）

**現状（L1416〜L1420）：**

```js
const msgPriorityMap = {
  urgent: { label: '🔴 緊急', cls: 'priority-urgent', itemCls: 'urgent', order: 0 },
  normal: { label: '🟡 通常', cls: 'priority-normal', itemCls: 'normal', order: 1 },
  info:   { label: '🟢 連絡', cls: 'priority-info',   itemCls: 'info',   order: 2 },
};
```

**修正後：** `label` の文字列のみを変更する。

```js
const msgPriorityMap = {
  urgent: { label: '至急', cls: 'priority-urgent', itemCls: 'urgent', order: 0 },
  normal: { label: '注意', cls: 'priority-normal', itemCls: 'normal', order: 1 },
  info:   { label: '連絡', cls: 'priority-info',   itemCls: 'info',   order: 2 },
};
```

**要点：**

- 絵文字（🔴🟡🟢）と、その後ろの**半角スペースも削除**する
- **`cls` / `itemCls` / `order` は1文字も変更しないこと**
- キー名（`urgent` / `normal` / `info`）も変更しないこと
- **CSSに触れないこと。** 色は枠と文字に残るため、絵文字を消しても情報は保たれる

### 4-4 【修正④】引き継ぎの種別ラベルから絵文字を削除する（論点5）

**現状（L1381〜L1393）：**

```js
function getHandoverLabel(item) {
  const isConfirmed = item._fullyConfirmed || item._confirmed > 0;
  if (item.priority === 'action') {
    return isConfirmed
      ? { label: '🔴 重要・対応済', cls: 'priority-urgent', itemCls: 'urgent' }
      : { label: '🔴 重要・未確認', cls: 'priority-urgent', itemCls: 'urgent' };
  }
  if (item.priority === 'done') {
    return { label: '🟢 確認要・確認済', cls: 'priority-info', itemCls: 'info' };
  }
  return isConfirmed
    ? { label: '🟡 通常・確認済', cls: 'priority-normal', itemCls: 'normal' }
    : { label: '🟡 通常・未確認', cls: 'priority-normal', itemCls: 'normal' };
}
```

**修正後：** 絵文字と半角スペースのみを削除する。

```js
function getHandoverLabel(item) {
  const isConfirmed = item._fullyConfirmed || item._confirmed > 0;
  if (item.priority === 'action') {
    return isConfirmed
      ? { label: '重要・対応済', cls: 'priority-urgent', itemCls: 'urgent' }
      : { label: '重要・未確認', cls: 'priority-urgent', itemCls: 'urgent' };
  }
  if (item.priority === 'done') {
    return { label: '確認要・確認済', cls: 'priority-info', itemCls: 'info' };
  }
  return isConfirmed
    ? { label: '通常・確認済', cls: 'priority-normal', itemCls: 'normal' }
    : { label: '通常・未確認', cls: 'priority-normal', itemCls: 'normal' };
}
```

**要点：**

- **語幹（重要／通常／確認要）は変更しない。** 既にスマートフォンと一致している
- **接尾辞（・未確認／・対応済／・確認済）は維持する。** サイネージは操作できない画面であり、確認状態が文字で分かる価値がある（第151回で明示）
- **`isConfirmed` の判定ロジック・分岐条件を変更しないこと**
- **`cls` / `itemCls` は1文字も変更しないこと**

### 4-5 【変更しない】中間の返信（論点4）

**第151回・論点4は現状維持と判定された。**

カード内は「元投稿の要約・最新返信・返信件数」の3要素に限定する現行仕様を維持する。**返信1・返信2 を表示する実装を追加しないこと。**

---

## 5. 修正の要約

| # | 行 | 変更前 | 変更後 |
|---|---|---|---|
| ① | L1638 | `item.id` / `item.sender_eo_uid` / `item.created_at` | `modalTarget.*`（`_latestReply` 優先） |
| ② | L1251 | `${timeStr} 最新活動` | `${timeStr} 送信` |
| ③ | L1417〜1419 | `🔴 緊急` / `🟡 通常` / `🟢 連絡` | `至急` / `注意` / `連絡` |
| ④ | L1385〜1392 | `🔴 重要・未確認` 等（5箇所） | `重要・未確認` 等（絵文字のみ削除） |

**実質10行程度の変更である。** これを大きく超える差分になっていたら、余計なことをしている。

---

## 6. 第142回の5関数限定との関係

第142回（EO-DEC-0142）は `signage.html` の変更を5関数（`loadMessage` / `buildItemHtml` / `openModal` / `openModalByIndex` / `messageItems.sort`）に限定した。

**修正③（`msgPriorityMap`）と修正④（`getHandoverLabel`）はその外側にある。**

**第151回判定により、これらは追加例外として明示的に許可された。** ただし条件がある。

> priority値、CSSクラス名、色、並び順、確認状態判定ロジックは変更しない。

**表示文字列のみの変更に留めること。**

---

## 7. 実装してはならないこと（明示）

| # | 禁止事項 | 理由 |
|---|---|---|
| 1 | 既読集計ロジック（L1690〜L1730）に触れる | **絶対保護。** 集計式は正しい。原因は渡すIDだけ |
| 2 | `item_receivers` の参照（L1708〜L1715）に触れる | EO-DEC-0125・絶対保護 |
| 3 | `signage-fetch` を変更する | **第151回判定により変更禁止** |
| 4 | `timeStr` の算出処理を変更する | 文言のみの変更である（最新活動日時を使う処理は正しい） |
| 5 | 相対表記（「8分前」等）にする | 5分ポーリングのため不適切（第151回で不採用） |
| 6 | `cls` / `itemCls` / `order` / priority値を変更する | 第151回の条件 |
| 7 | CSSを変更する | 色は枠と文字に残る。CSSに触れる必要はない |
| 8 | 引き継ぎの接尾辞（・未確認等）を削除する | 確認状態が分からなくなる（第151回で維持と明示） |
| 9 | 中間の返信を表示する | 論点4は現状維持 |
| 10 | `openModal()` の中身を変更する | 引数の渡し方のみを直す |
| 11 | `item.body` / `p.label` / `p.cls` を差し替える | 本文は `groupInfo` 経由。縦帯の色は元投稿のまま（第149回・第150回） |
| 12 | エラー分類を追加・変更する | 学び98（7/6 誤検知事故） |
| 13 | 新規ファイルを作成する | 本件に不要 |

---

## 8. PR に必ず記載すること

```
## 対象
- signage.html のみ（他ファイルは無変更）

## 変更した箇所（4箇所）
- L1638      : openModal へ _latestReply の id / sender_eo_uid / created_at を渡す [論点1]
- L1251      : 「最新活動」→「送信」                                              [論点2]
- L1417-1419 : msgPriorityMap の label を 至急/注意/連絡 に（絵文字削除）          [論点5]
- L1385-1392 : getHandoverLabel の label から絵文字を削除（語幹・接尾辞は維持）    [論点5]

## 触れていないことの確認
- [ ] 既読集計ロジック本体（L1690-L1730）に触れていない
- [ ] item_receivers の参照ロジックに触れていない
- [ ] openModal() の中身を変更していない（引数のみ）
- [ ] signage-fetch を変更していない
- [ ] token認証・token復元・エラー分類に触れていない
- [ ] 5分ポーリング・深夜3時リロード・60秒リトライに触れていない
- [ ] 投稿グループの組み立て・並び順に触れていない
- [ ] cls / itemCls / order / priority値 を変更していない
- [ ] CSSを変更していない
- [ ] 引き継ぎの接尾辞（・未確認／・確認済等）を維持している
- [ ] getHandoverLabel の分岐条件・isConfirmed 判定を変更していない
- [ ] timeStr の算出処理を変更していない（文言のみ）
- [ ] 中間の返信を表示する実装を追加していない
- [ ] index.html / js/ 配下 / styles.css を変更していない
- [ ] 新規ファイルを作成していない
```

---

## 9. 野口さん側の作業

| # | 作業 |
|---|---|
| 1 | **PR マージ前に切り戻しタグを打つ**：`pre-signage-modal-fix` |
| 2 | 本番反映後、サイネージ端末で実機確認（第10章） |
| 3 | **表示が変わらない場合、Fully Kiosk を終了・再起動する**（キャッシュ対策） |

---

## 10. 実機確認の項目

**確認に使うデータ**：フロント2の「返信3」が付いた投稿グループ

| # | 確認内容 | 期待値 |
|---|---|---|
| **1** | **投稿グループをタップしてモーダルを開く** | **既読0名／未読2名（よつば・三郎）** |
| **2** | **スマートフォンの同じ投稿と比較** | **既読・未読の名簿が一致する** |
| 3 | 返信の無い投稿のモーダル | 従来どおり正しい既読が出る |
| 4 | 引き継ぎのモーダル | 従来どおり |
| **5** | カードの時刻表示 | 「**7月24日 19:03 送信**」（「最新活動」でない） |
| 6 | 通常の連絡の時刻表示 | 従来どおり「送信」 |
| **7** | **連絡の種別ラベル** | **至急／注意／連絡**（絵文字なし） |
| **8** | **引き継ぎの種別ラベル** | **重要・未確認／確認要・確認済 等**（絵文字なし・接尾辞あり） |
| 9 | 縦帯の色 | **変わっていない**（赤・黄・緑） |
| 10 | ラベルの枠と文字色 | **変わっていない**（色が残っている） |
| 11 | 並び順 | 変わっていない |
| 12 | 中間の返信 | **表示されない**（現状維持） |
| **13** | **5分待つ** | **画面が維持される。「サイネージが無効になりました」が出ない** |
| 14 | 天気・WBGT・QR・LINK | 従来どおり |

**1・2 が本Issueの核心である。** スマートフォンと既読の名簿が一致することを必ず確認すること。

**13 も必ず確認すること。** 5分ポーリング後に画面が維持されることは、2026/7/6 の事故以来の必須確認項目である。

---

## 11. 参照文書

| 文書 | 該当箇所 |
|---|---|
| EO-DEC-0151（第151回判定） | **本書の根拠** |
| EO-DEC-0142（第142回） | signage.html の5関数限定（本件はその追加例外） |
| EO-DEC-0125（第125回） | item_receivers によるスナップショット方式 |
| EO-DEC-0148（第148回） | サイネージは3要素に限定（論点4の根拠） |
| EO-DEC-0116（第116回） | ④絵文字を使わない／⑤色だけを情報伝達手段にしない |
| `EdgeOps_サイネージ機能_仕様書_v2_4.docx` | 第15章・第16章 |

以上。
