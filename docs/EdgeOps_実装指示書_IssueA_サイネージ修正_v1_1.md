# EdgeOps 実装指示書 Issue A サイネージ修正 v1.1

**日付**:2026/8/1 ／ **起案**:Web Claude ／ **実装**:GitHub Copilot
**改訂**:v1.0 の修正1(コピーボタン配線)を取り下げ。トークンをUIに露出させないのは意図した設計(野口判断・2026/8/1)。本書は修正2のみ
**性質**:不具合の是正。新ロジックなし・DB変更なし
**この指示書に完全に従うこと。指示書にない変更を行わないこと。**

---

## 0. 変更対象ファイル

| ファイル | 変更内容 |
|---|---|
| `index.html` | `generateSignageToken()` 内の update に1プロパティ追加(下記のみ) |

**変更はこの1ファイル・1箇所だけ。** 以下は一切触らない:
- `js/ui-helpers.js`(`copySignageUrl()` と `copy-signage-btn` の表示制御が存在するが、**配線しないこと・削除もしないこと**。未配線は意図した状態である)
- `js/i18n.js` ／ `signage.html` ／ `styles.css` ／ Edge Function ／ DB
- **`id="copy-signage-btn"` の要素を index.html に追加してはならない**(v1.0 の修正1は取り下げ済み)

---

## 修正:URL再生成時に is_signage を false にする

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
| 1 | テストグループでサイネージURLを再生成 | 従来どおり「発行しました(全サイネージ端末は退出扱い)」トースト |
| 2 | SQLで当該グループの行を確認(下記) | `is_signage=true` の行が0件 |
| 3 | プロフィール画面のサイネージ管理欄 | 見た目・文言が従来から不変。**コピーボタンが存在しない**こと |
| 4 | 通常グループ回帰 | 再生成以外の挙動不変 |

確認2のSQL(読み取りのみ):
```sql
SELECT id, eo_uid, status, is_signage FROM group_members
WHERE group_session_id = '<テストグループのUUID>' AND is_signage = true;
```

---

## 手順(野口さん)

1. マージ前にタグ `pre-signage-fix` を作成(GitHub Releases UI・v1.0 で未作成の場合)
2. Issue起票(本書 v1.1 を docs/ に置き「完全に従うこと」と記載)→ Copilot PR
3. PR差分確認:**変更が index.html の1ファイル・generateSignageToken() 内の1箇所のみ**であること。コピーボタンや i18n キーが含まれていたらマージしない
4. マージ→実機確認1〜4

## スコープ外

- サイネージURLコピーボタン — **取り下げ(意図した設計・実装しない)**
- 厨房3 残存行(EU-7BD86329)の清掃SQL — DB直接変更のため第163回判定に載せて承認後に実施
- leaveGroup / cancelRequest 自動切替の期限切れevent除外 — 判定未取得・第163回候補

## 改訂履歴

- v1.0(2026/8/1):修正1(コピーボタン配線)＋修正2の2点構成
- v1.1(2026/8/1):修正1を取り下げ(トークン非露出は意図した設計)。修正2のみに縮小。Issue #84 / PR #85 はマージせずクローズ済み
