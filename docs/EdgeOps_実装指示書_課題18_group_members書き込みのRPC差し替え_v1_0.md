# EdgeOps 実装指示書 課題18-① フロントの直接書き込みをRPCへ差し替える v1.0

**配置先：`docs/EdgeOps_実装指示書_課題18_group_members書き込みのRPC差し替え_v1_0.md`**

- 起案：Web Claude ／ 決裁：野口秀作 ／ 実装：GitHub Copilot
- 日付：2026/8/9
- 根拠判定：**EO-DEC-0203**（第203回・条件付きGO）／EO-DEC-0186（権限撤去工程の移管）／EO-DEC-0187（実施手順の6段階固定）
- 実コード確認：2026/8/9・`raw.githubusercontent.com`（`enoshimaedge/EdgeOps` main・Batch5および神奈川県PR マージ後）／`index.html` 5,130行
- **RPC6本は2026/8/9に本番作成済み**（`migration_log id=86`。ROLLBACK 空撃ちで全ガード通過を実証済み）

---

## 0. このPRでやること

`index.html` にある `group_members` への**直接 UPDATE / DELETE 計7箇所**を、作成済みのRPC6本の呼び出しへ置き換える。

**★このPRでは REVOKE を行わない。** 第187回で固定された手順は ①RPC差し替え → ②実機確認 → ③REVOKE → ④権限確認 → ⑤再実機確認 → ⑥記録 であり、本PRは①にあたる。

---

## 1. 変更対象ファイル

**`index.html` のみ。** 他のファイルは一切変更しない（`signage.html`・`admin.html`・`manager.html`・`auth.js`・`styles.css`・`js/` 配下すべて）。

**DB変更なし。** RPCは作成済み。

---

## 2. 変更禁止領域（★最重要）

| # | 禁止事項 |
|---|---|
| 1 | **`group_members` への SELECT には一切触らない。** 本PRの対象は UPDATE / DELETE の7箇所のみ。参照31箇所のうち残り24箇所は差分0にすること |
| 2 | **`group_sessions` への UPDATE 6箇所に触らない**（L3963／L4159／L4205／L4256／L4291／L4711）。EO-DEC-0203 論点4により別判定・別工程 |
| 3 | **不可触関数のうち、本指示書が明示した箇所以外を変更しない。** `generateSignageToken` は「`group_members` への UPDATE 1文」だけ置換してよい。同関数内の `group_sessions` の update（L4711）・トークン生成・`currentGroup` の更新・`updateSignageUrlDisplay()`・トーストには**触らない** |
| 4 | `restoreSession`・`joinGroup`・`ensureCurrentUser` は**一切触らない** |
| 5 | 承認後のサイネージURL自動発行の処理（`approveMember` 内・`group_sessions` を触る部分）に**触らない** |
| 6 | 既読集計・`realReadMap`・`item_receivers`・`read_receipts`・`receiver_count`・`message_responses` の削除処理に**触らない** |
| 7 | 期限切れ event の除外ロジック（EO-DEC-0163 / 0180 / 0181）に**触らない** |
| 8 | 各関数の**処理順・トースト文言・確認ダイアログの文言・後続の `loadApprovals()` / `loadMessages()` などの呼び出しを変更しない** |

---

## 3. 差し替えの共通ルール

- 呼び出しは `supabase.rpc('RPC名', { 引数名: 値 })` の形にする
- **戻り値の `error` を必ず確認し、エラーなら既存の `catch` と同じトースト文言を出して処理を止める**（RPCは `RAISE EXCEPTION` を返すため、従来の「黙って失敗」から「明示的に失敗」へ変わる）
- **成功時の後続処理（画面遷移・再読込・トースト）は現状のまま維持する**
- 引数名は下表のとおり。**RPC側は作成済みなので、引数名を変えてはならない**

| RPC | 引数 |
|---|---|
| `member_update_display_name` | `p_member_id`（uuid）／`p_display_name`（text） |
| `member_cancel_request` | `p_member_id`（uuid） |
| `member_approve` | `p_member_id`（uuid） |
| `member_reject` | `p_member_id`（uuid） |
| `member_leave` | `p_member_id`（uuid） |
| `signage_force_leave` | `p_group_session_id`（uuid） |

---

## 4. 差し替え箇所（7箇所 → 6本）

### 4-1. A｜`cancelRequest`（L2153〜・該当 L2158）

**現状**

```
await supabase.from('group_members').delete().eq('id', currentMemberId);
```

**変更後**：`member_cancel_request` を呼ぶ。`p_member_id` に `currentMemberId` を渡す。

- **`currentMemberId = null;` の代入と、それ以降の「申請取消後の他グループ自動切替」の処理には触らない**
- エラー時は `showToast('申請の取り消しに失敗しました。')` を出して `return`（`currentMemberId` を null にしない）

### 4-2. B｜`approveMember`（L3930〜・該当 L3937）

**現状**

```
await supabase.from('group_members').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', memberId);
```

**変更後**：`member_approve` を呼ぶ。`p_member_id` に `memberId` を渡す。

- **冒頭の `isEventGeneralMember()` によるガードは残す**（RPC側にも同等のガードがあるが、UIの早期リターンとして維持する）
- **★後続のサイネージURL自動発行の処理には触らない。** ただし `approvedMember?.is_signage` を得るための `select('is_signage')` の再取得は、**RPCの戻り値 `is_signage` を使う形に置き換えてよい**（クエリが1本減る）。置き換える場合も、そこから先の `group_sessions` を触る処理は一切変更しない
- エラー時は既存の `catch` と同じ `showToast('エラーが発生しました。')`

### 4-3. C｜`rejectMember`（L3997〜・該当 L4005）

**現状**

```
await supabase.from('group_members')
  .update({ status: 'rejected' })
  .eq('id', memberId)
  .eq('status', 'pending');
```

**変更後**：`member_reject` を呼ぶ。`p_member_id` に `memberId` を渡す。

- `.eq('status','pending')` はRPC側に移っているので、フロントに残さない
- 成功時のトースト・`loadApprovals()`・`loadMessages()` は変更しない

### 4-4. D｜`updateDisplayName`（L4543〜・該当 L4547）

**現状**

```
await supabase.from('group_members').update({ display_name: newName }).eq('id', currentMemberId);
```

**変更後**：`member_update_display_name` を呼ぶ。`p_member_id` に `currentMemberId`、`p_display_name` に `newName` を渡す。

- **エラー時は `currentUser.display_name` を書き換えないこと。** 現状は更新結果を確認せずローカル変数を書き換えているため、失敗しても画面上は成功して見える。RPC化にあわせ、成功したときだけ `currentUser.display_name` と `profile-name` を更新する
- エラー時のトーストは既存の `showToast('更新に失敗しました。')`

### 4-5. E｜`generateSignageToken`（L4705〜・該当 L4716）★不可触関数・限定例外

**現状**

```
const { error: leaveError } = await supabase.from('group_members')
  .update({ status: 'left', is_signage: false })
  .eq('group_session_id', currentGroup.id)
  .eq('is_signage', true)
  .neq('status', 'left');
if (leaveError) throw leaveError;
```

**変更後**：`signage_force_leave` を呼ぶ。`p_group_session_id` に `currentGroup.id` を渡す。エラーなら現状と同じく `throw` する。

- **★この1文だけを置き換える。** 直前の `group_sessions` の update（L4711）・トークン生成・`currentGroup.signage_token` の代入・`updateSignageUrlDisplay()`・トーストには**一切触らない**

### 4-6. F＋G｜`leaveGroup`（L4731〜・該当 L4755・L4760）★2箇所を1本に統合

**現状**（2箇所が別々のクエリ）

- L4745〜：`is_creator` なら最古参メンバーを1件 SELECT
- L4755：その最古参へ `is_creator = true` を UPDATE
- L4760：本人を `status='left'` / `is_creator=false` / `is_signage=false` に UPDATE

**変更後**：**上の3つ（SELECT 1本＋UPDATE 2本）をまとめて `member_leave` の1回の呼び出しに置き換える。** `p_member_id` に `currentMemberId` を渡す。

- **`if (isCreator) { ... }` のブロックごと削除してよい。** 引き継ぎ先の決定はRPC内で行う（判定により、選定ルールは現行と同一＝`approved` かつ本人以外かつ非サイネージ、`created_at` 昇順の1件）
- **★これ以降の処理には触らない。** アンケート回答の削除（`message_responses`）・退出後の他グループ自動切替・`isLeaving` ガード・ローディング表示の解除（`finally`）はすべて現状のまま
- エラー時は既存の `catch` と同じ扱いにし、**退出が失敗したのに画面が遷移しないようにする**

---

## 5. 完了条件（機械検証・全項目を満たすこと）

| # | 条件 |
|---|---|
| 1 | 変更ファイルが **`index.html` の1つだけ** |
| 2 | `index.html` 内に **`from('group_members')` を含む UPDATE / DELETE / INSERT が0件**（SELECT のみ残る） |
| 3 | `from('group_members')` の**総出現数が 31 → 28 になっている**（A・D・Gの3箇所が消え、F の SELECT も消えるため。※実装により前後してよいが、書き込みが0件であることは必須） |
| 4 | `supabase.rpc('member_cancel_request'` / `'member_approve'` / `'member_reject'` / `'member_update_display_name'` / `'member_leave'` / `'signage_force_leave'` が**各1回以上**出現する |
| 5 | `from('group_sessions')` への `update` が**6箇所のまま**（差分0） |
| 6 | `restoreSession` / `joinGroup` / `ensureCurrentUser` の差分が**0** |
| 7 | `generateSignageToken` の差分が **`group_members` の update 1文の置換のみ** |
| 8 | `isEventGeneralMember()` の呼び出しが `approveMember`・`rejectMember`・`loadApprovals` に**残っている** |
| 9 | 確認ダイアログとトーストの**文言が変わっていない**（新規追加分を除く） |
| 10 | `signage.html`・`admin.html`・`manager.html`・`auth.js`・`styles.css`・`js/` 配下の差分が**0** |
| 11 | 新規のSQL・migration ファイルが**追加されていない** |
| 12 | `index.html` の**キャッシュバスターは変更しない**（`js/` 配下を変更しないため） |

---

## 6. ロールバック

**マージ前に必ずタグ `pre-revoke-members` を打つ。GitHub Release の label は `None`。**

本PRはコードのみでDB変更を伴わないため、問題発生時は当該タグへ戻すだけで完結する。**RPCは作成済みのまま残しても害はない**（呼ぶ側がいなくなるだけ）。

---

## 7. マージ後の実機確認（②・8項目）

**★`社員⭐︎`（顧客本番）では実機確認・投稿・退出を一切行わない。**

| # | 項目 | 対応 |
|---|---|---|
| 1 | 参加申請 → **取り消し** | A |
| 2 | 参加申請 → **承認** | B |
| 3 | 参加申請 → **却下** | C |
| 4 | **表示名の変更** | D |
| 5 | **サイネージURLの発行**（既存サイネージ端末が退出扱いになる） | E |
| 6 | **一般メンバーの退出** | G |
| 7 | **管理者の退出**（最古参へ引き継がれる） | F＋G |
| 8 | 投稿・既読・グループ切替・引き継ぎの回帰 | ― |

**★8項目すべてを通過するまで、③REVOKE へ進まない。** 差し替え漏れが1箇所でもあれば、REVOKE した瞬間にその機能が停止する。

以上。
