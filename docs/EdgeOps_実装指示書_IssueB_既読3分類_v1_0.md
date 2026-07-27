# EdgeOps 実装指示書 Issue B 既読3分類と機械既読廃止(スマホ側) v1.0

**日付**:2026/8/1 ／ **起案**:Web Claude ／ **実装**:GitHub Copilot
**判定**:第162回(EO-DEC-0162)条件付きGO。Q1〜Q3・Q5〜Q8はGO。退出日は表示せず「(退出済み)」表記(判定条件)
**根拠データ**:read_receipts に UNIQUE(message_id, eo_uid) 実在・重複0件をSQL確認済み(2026/8/1)
**この指示書に完全に従うこと。指示書にない変更を行わないこと。**

---

## 0. 変更対象ファイル(この2つ以外を変更してはならない)

| ファイル | 変更 |
|---|---|
| `index.html` | 修正1〜4 |
| `js/i18n.js` | 修正5(キー3組追加) |

**触ってはならないもの**:DB・RPC・`recordRead()`・`item_receivers`への書き込み経路・`signage.html`・`signage-fetch`(サイネージ側は別PR)・引き継ぎ(`handover`系)の集計・`js/ui-helpers.js`・`styles.css`。
**既存コメントは削除せず残す。** 変更箇所には `// [EO-DEC-0162]` を付す。

---

## 修正1:leaveGroup() の機械既読ブロックを撤去

`leaveGroup()` 内、`stopPolling();` の直後から始まる「退出時:自分が未読のメッセージのread_countを+1して既読扱いにする」のブロックを**丸ごと削除**する。削除範囲は次の4処理すべて:

1. `receivedMsgIds` の抽出(messages から自分が送信者でないIDを集める)
2. `myReceipts` の取得と `unreadMsgIds` の算出
3. `read_receipts` への一括INSERT(`[EO-DEC-0161 案ア]` コメントのブロック)
4. `Promise.allSettled` による `read_count` +1 更新

削除位置に次のコメントを1行残す:
```js
// [EO-DEC-0162] 退出時の機械既読は廃止。未読のまま退出した事実はそのまま表示する(第162回判定)。
```

**それより後(管理者の昇格引き継ぎ・status更新・アンケート回答クリーンアップ・自動切替)は一切変更しない。** `isLeaving` ガード・`#loading` 表示も変更しない。

---

## 修正2:showDetail() の3分類化(item_receivers があるメッセージのみ)

### 2-1 取得クエリの拡張
`allMembersForJoinedAtDetail` を取得する `group_members` クエリの select を
`'eo_uid, created_at'` → `'eo_uid, created_at, status, display_name, is_signage'` に変更し、
`eo_uid` をキーにした Map(`allMemberMap` と呼ぶ)を作る。

### 2-2 snapshotRows がある場合(送信時の顔ぶれが正本)
既存の `if (Array.isArray(snapshotRows) && snapshotRows.length > 0)` 分岐内を次の導出に変更する:

```
snapshotUids   = item_receivers の receiver_eo_uid 集合(送信時の顔ぶれ)
approvedUids   = members(現在approved)の eo_uid 集合
readSet        = reads のうち snapshotUids に含まれる eo_uid の集合
                 ※在籍・退出を問わない。memberUids による在籍フィルタはこの経路では使わない
既読           = readSet
未読(在籍)     = snapshotUids − readSet のうち approvedUids に含まれる人
未読のまま退出 = snapshotUids − readSet のうち approvedUids に含まれない人
```

カード数値:
- `detail-read-count` = readSet の人数
- `detail-unread-count` = 未読(在籍)の人数
- `detail-left-count`(新設) = 未読のまま退出の人数
- `detail-total-count` = 従来どおり `receiver_count`(nullならsnapshot人数)

既読名簿(`detail-read-list`):readSet を read_at 昇順で描画。名前は members から、居なければ `allMemberMap` から引く。**退出済み(approvedUids に含まれない)の行は、名前を `color:#8B959E` にし、名前の後ろに `t('label_left_member')` を付す。時刻は表示する。**

未読名簿(`detail-unread-list`):未読(在籍)のみ。現行の見た目(赤系)を維持。

### 2-3 snapshotRows が無い場合(過去分)
**現行ロジックを一切変更しない**(第162回Q5:過去分は経過措置)。`detail-left-count` は 0 を表示する。

### 2-4 名簿の新枠
`detail-unread-list` を含む card の**直後**に、同じ card 構造で新枠を追加:

```html
<div class="card">
  <div style="padding:12px 16px; font-size:13px; font-weight:700; color:var(--text-mid); border-bottom:1px solid var(--border);" id="detail-left-heading">未読のまま退出</div>
  <div id="detail-left-list"></div>
</div>
```

描画:未読のまま退出の各人を `<div class="person-row">` で、名前 `color:#8B959E`＋`t('label_left_member')` のみ(時刻なし・赤系装飾なし)。0人なら card ごと `display:none` にする。見出しテキストは `t('heading_left_unread_list')` を設定する。

### 2-5 E7(eventの一般参加者)への追従
`isEventGeneralMember()` の分岐で、既存の既読/未読cardと同様に**新枠の card も非表示**にする(表示側の復帰も同様)。

---

## 修正3:4枚目のサマリカード(HTML)

`detail-stats-row` 内、未読カードと合計カードの**間**に追加:

```html
<div class="card" style="flex:1; padding:16px; text-align:center; margin-bottom:0;">
  <div style="font-size:28px; font-weight:700; color:var(--text-mid);" id="detail-left-count">0</div>
  <div style="font-size:12px; color:var(--text-light); line-height:1.3;" id="detail-left-label">未読のまま退出</div>
</div>
```

`showDetail()` 内のラベル設定行に `detail-left-label` = `t('stat_left_unread')` を追加する。既存3枚の構造・順序は変更しない(数字が上・ラベルが下の並びを4枚で統一)。

---

## 修正4:一覧の「全員既読」判定式(表示テキストは不変)

### 4-1 applyReadCorrection() の拡張
`realReadMap` 算出の後に、次を追加する:

1. `item_receivers` を1クエリで一括取得:`.select('item_id, receiver_eo_uid').eq('item_type','message').in('item_id', msgIds)`
2. メッセージごとに `未読のまま退出数 = snapshotのuidのうち、そのメッセージのreceiptが無く、かつ現在approvedのmembersに居ない人数` を数え、`window._leftUnreadMap = { [messageId]: 数 }` に保存する(グループ切替時は再計算で上書きされるため初期化処理は不要)

**realReadMap 本体のロジック(署名者・サイネージ・送信後参加の除外)は変更しない。**

### 4-2 判定式の変更(2箇所)
`eoReadHtmlOf()` と、投稿グループ描画内の同型コード(`read_all` を出すもう1箇所)の**全員既読判定のみ**変更:

```js
// 変更前
(readCount >= receiverCount)
// 変更後
((readCount + (window._leftUnreadMap?.[msg.id] || 0)) >= receiverCount)
```

「既読 X/Y」の X・Y の値と見た目は**一切変更しない**(第162回Q3:一覧の見た目維持・判定式のみ)。

---

## 修正5:js/i18n.js キー追加(ja/en 両方・既存キーの変更削除禁止)

| キー | ja | en |
|---|---|---|
| `stat_left_unread` | 未読のまま退出 | Left unread |
| `heading_left_unread_list` | 未読のまま退出 | Left without reading |
| `label_left_member` | （退出済み） | (Left) |

---

## 実機確認(野口さん・マージ後)

**テストは江の島フットボールクラブまたはテスト専用グループ。社員⭐︎・フロントでは退出テストをしない。**

| # | 操作 | 期待 |
|---|---|---|
| 1 | 2端末で参加→Aが投稿→Bが**開かずに**退出 | 詳細:既読0・未読0・未読のまま退出1・合計1。名簿の新枠にBがグレー＋（退出済み） |
| 2 | 同、一覧のバッジ | 「全員既読」表示(実既読0＋退出1≧分母1) |
| 3 | Bを再参加→Aが再投稿→Bが**開いてから**退出 | 詳細:既読1(Bグレー＋（退出済み）＋時刻)・未読0・未読のまま退出0 |
| 4 | 退出したBの read_receipts をSQL確認 | **退出時に新規レコードが増えていない**(機械既読が作られない) |
| 5 | 在籍Cが未読の投稿 | 未読名簿にCが赤系で出る(現行どおり)。退出者は未読名簿に出ない |
| 6 | 過去の投稿(item_receivers無し) | 表示が従来と不変・4枚目カードは0 |
| 7 | eventグループの一般参加者 | 4枚カード・3枠名簿がすべて非表示(E7維持) |
| 8 | 通常グループ回帰 | 投稿・返信・削除・引き継ぎ・サイネージ表示が従来どおり |

確認4のSQL(読み取りのみ):
```sql
SELECT count(*) FROM read_receipts WHERE eo_uid = '<Bのeo_uid>';
```
退出の前後で件数が変わらないこと。

---

## 手順(野口さん)

1. マージ前にタグ `pre-read-3class` を作成
2. Issue起票(本書全文を本文に貼付)→ Copilot PR
3. PR差分確認:**index.html と js/i18n.js の2ファイルのみ**。leaveGroup の削除ブロックが修正1の範囲と一致すること
4. マージ→実機確認1〜8

## スコープ外

- サイネージ側の「未読のまま退出 N人」1行表示(第162回Q4) — **別PR**。signage-fetch のDeployを伴うため論点B実装と同時(8/2以降)
- 既読未読の考え方 仕様書の v1.2 改訂 — 実機確認完了後に文書作業として実施
- read_count の正本化(Q7) — read_count は現状維持・一覧の分子は変更しない
- 引き継ぎ(handover_confirmations)側 — 対象外
