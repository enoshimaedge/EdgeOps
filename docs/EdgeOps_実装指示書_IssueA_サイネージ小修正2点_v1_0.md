# EdgeOps 実装指示書 Issue A サイネージ小修正2点 v1.0

**日付**:2026/8/1 ／ **起案**:Web Claude ／ **実装**:GitHub Copilot
**根拠**:残課題(v31スケジュール 8/7-4・8/7-5)。実コード確認により未実装と確定(2026/8/1)
**性質**:実装漏れ・不具合の是正。新ロジックなし・DB変更なし
**この指示書に完全に従うこと。指示書にない変更を行わないこと。**

---

## 0. 変更対象ファイル(この2つ以外を変更してはならない)

| ファイル | 変更内容 |
|---|---|
| `index.html` | 修正1(ボタン要素1個追加)＋修正2(update引数に1プロパティ追加) |
| `js/i18n.js` | 修正1のi18nキー1組(ja/en)追加 |

**触ってはならないもの**:`js/ui-helpers.js`(コピー関数は実装済み)・`signage.html`・`styles.css`・Edge Function・DB。

---

## 修正1:サイネージURLコピーボタンの配線

### 背景
`js/ui-helpers.js` には `copySignageUrl()` 関数と、`updateSignageUrlDisplay()` 内の表示制御(`document.getElementById('copy-signage-btn')` の display 切替)が**実装済み**。しかし `index.html` に `id="copy-signage-btn"` の要素が存在せず、未配線のまま。

### 変更内容
`index.html` のプロフィール画面「サイネージ管理」欄(見出し `data-i18n="heading_signage"` のブロック内)で、**`onclick="generateSignageToken()"` のボタンの直前**に次の1要素を追加する:

```html
<button id="copy-signage-btn" class="btn btn-secondary" onclick="copySignageUrl()"
  style="font-size:13px; padding:10px 8px; width:100%; margin-bottom:8px; display:none;"
  data-i18n="btn_copy_signage_url">サイネージURLをコピー</button>
```

要点:
- `id="copy-signage-btn"`(ui-helpers.js の参照名と完全一致・変更不可)
- 初期状態は `display:none`。表示・非表示は既存の `updateSignageUrlDisplay()` が制御する(発行済み＆有効のときのみ block)。**JS側の表示制御を新たに書かないこと**
- 既存の「トークンを再生成する」ボタン・注意書きは一切変更しない

### `js/i18n.js` への追加
ja / en の両オブジェクトに次の1キーを追加する(既存キーの変更・削除は禁止):

| キー | ja | en |
|---|---|---|
| `btn_copy_signage_url` | サイネージURLをコピー | Copy signage URL |

---

## 修正2:URL再生成時に is_signage を false にする

### 背景
`generateSignageToken()`(`index.html` 内)は再生成時に全サイネージ端末を `status:'left'` にするが、`is_signage` を false にしていない。このため「status=left かつ is_signage=true」の残存行が発生する(実例:厨房3 の EU-7BD86329)。退出処理 `leaveGroup()` は自分自身に `is_signage:false` を設定しており、挙動が不揃い。

### 変更内容
`generateSignageToken()` 内の強制退出 update(`.eq('is_signage', true)` を条件に持つ update)の更新オブジェクトへ `is_signage: false` を追加する:

```js
// 変更前
.update({ status: 'left' })
// 変更後
.update({ status: 'left', is_signage: false })
```

この1プロパティ追加のみ。confirm文言・token生成・`signage_enabled` 更新・`updateSignageUrlDisplay()` 呼び出しは変更しない。

---

## 実機確認(野口さん・マージ後)

**テストは「フロント」または「江の島フットボールクラブ」で行う。社員⭐︎では行わない。**

| # | 操作 | 期待 |
|---|---|---|
| 1 | 管理者でプロフィール画面を開く(URL発行済みグループ) | 「サイネージURLをコピー」ボタンが表示される |
| 2 | ボタンを押す | 「URLをコピーしました」トースト。貼り付けると `signage.html?token=…` |
| 3 | 一般メンバーでプロフィール画面 | サイネージ管理欄自体が管理者のみのため見えない(従来どおり) |
| 4 | URL未発行のグループの管理者 | コピーボタンが**出ない** |
| 5 | テストグループでURL再生成 | 旧サイネージ端末が退出扱いになり、SQLで該当行の `is_signage=false` を確認 |
| 6 | 通常グループ回帰 | 再生成ボタン・注意書き・プロフィール他要素の見た目不変 |

確認5のSQL(読み取りのみ):
```sql
SELECT id, eo_uid, status, is_signage FROM group_members
WHERE group_session_id = '<テストグループのUUID>' AND is_signage = true;
```
再生成後は0件になること。

---

## 手順(野口さん)

1. マージ前にタグ `pre-signage-fix` を作成(GitHub Releases UI)
2. Issue起票(本指示書を docs/ に置き「完全に従うこと」と記載)→ Copilot PR
3. PR差分確認:**変更が index.html と js/i18n.js の2ファイルのみ**であること(それ以外があればマージしない)
4. マージ→実機確認1〜6

## スコープ外(本Issueに含めない)

- 厨房3 残存行(EU-7BD86329)の清掃SQL — DB直接変更のため別途(下記参照)
- leaveGroup / cancelRequest 自動切替の期限切れevent除外 — 判定未取得・第163回候補
- read_count キャッシュのズレ調査 — 第162回Q7の範囲
