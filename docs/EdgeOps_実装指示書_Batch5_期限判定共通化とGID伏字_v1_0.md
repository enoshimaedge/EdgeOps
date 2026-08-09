# EdgeOps 実装指示書 Batch5（期限判定の共通化・GID伏字表示）v1.0

**配置先：`docs/EdgeOps_実装指示書_Batch5_期限判定共通化とGID伏字_v1_0.md`**

- 起案：Web Claude ／ 決裁：野口秀作 ／ 実装：GitHub Copilot
- 日付：2026/8/9（連休3日目・Batch5）
- 根拠判定：**EO-DEC-0187**（Batch5）／**EO-DEC-0196**（論点1 GID伏字・論点7 期限条件）／**EO-DEC-0198**（条件C・D）／**EO-DEC-0199**（取得経路の統一）／**EO-DEC-0200**（列追加範囲の縮小・`joinGroup` 例外）／**EO-DEC-0201**（`restoreSession` 例外・3条件・undefined の扱い）
- 実コード確認：2026/8/9 昼・`raw.githubusercontent.com`（`enoshimaedge/EdgeOps` main）／`index.html` 5,109行・`js/ui-helpers.js` 513行

---

## 0. このPRでやること（4項目・この順に実装する）

| # | 内容 |
|---|---|
| **①** | `currentGroup` を手組みしている2箇所を、`group_sessions` の実行取得へ置き換える |
| **②** | 1年期限管理の適用条件を判定する共通関数 `isExpiryManaged()` を新設する |
| **③** | 期限に関わる3経路を、すべて②の関数へ統一する |
| **④** | `gid_masked=true` のグループでGIDを伏字表示する |

**★実装順を入れ替えないこと。** ②は①が完了していないと正しく動かない。③は②に依存する。

---

## 1. 変更対象ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | ①③④ |
| `js/ui-helpers.js` | ②③④（共通関数2本の新設・期限警告バー） |

**この2ファイル以外を変更しない。** `signage.html`・`admin.html`・`manager.html`・`auth.js`・`styles.css`・`js/i18n.js`・Edge Function・SQL は**一切変更しない**。

### DB変更

**なし。** `gid_masked`・`facility_id`・`archived_at` はすべて追加済みの既存列である。

---

## 2. 変更禁止領域（★最重要）

| # | 禁止事項 |
|---|---|
| 1 | **L3保護領域**（`group_sessions` / `group_members` / `messages`）への**直接UPDATE・DELETE・スキーマ変更**を行わない。本PRはSELECTのみ |
| 2 | **不可触RPCを変更しない**：`create_group_with_creator` / `join_group_with_member` |
| 3 | **不可触関数のうち、本指示書が明示した箇所以外を変更しない**：`restoreSession`（変更してよいのは L1671 の `if` 条件の左辺のみ）／`joinGroup`（変更してよいのは `already_approved` 分岐のみ）／`generateSignageToken`・`ensureCurrentUser` は**一切触らない** |
| 4 | **下記4箇所の列指定SELECTを変更しない**（理由は第9章）：`restoreSession` L1682 ／ `notifyExpiredEvents` L1754 ／ `updateGroupSwitcherBtn`（`index.html` L4633）／ `leaveGroup` L4774 |
| 5 | **`group_sessions(*)` の既存5経路を変更しない**：`restoreSession` L1594・L1615 ／ `checkApproval` L2124 ／ `switchGroup` ／ その他 |
| 6 | 期限切れ **event** の除外ロジック（EO-DEC-0163 / 0180 / 0181）に**一切触らない**。本PRの期限管理とは別の判定である |
| 7 | 既読集計・`realReadMap`・`item_receivers`・`read_receipts`・`receiver_count` に触らない |
| 8 | `js/ui-helpers.js` 末尾の `updateGroupSwitcherBtn`（旧版・死にコード）を**削除しない**。本PRの対象外 |

---

## 3. ① `currentGroup` の取得経路を揃える

### 背景（第9章に理由の全文あり）

`currentGroup` を作る経路は7つある。うち5つは `group_sessions(*)` で全列を取得しているが、**2つはRPC戻り値からオブジェクトを手組みしており、`facility_id`・`archived_at`・`gid_masked` を持たない。** ②の判定関数がこれらの列を見るため、先に形を揃える。

**★RPC本体を確認済み：`join_group_with_member` の `jsonb_build_object` は5経路すべてで `expires_at`・`facility_id`・`archived_at` を返していない。** よってRPC戻り値からの手組みでは列を補えない。不可触RPCは変更しないため（EO-DEC-0200 論点2-b）、**`group_sessions` を実際に取得する方式（案ア-1）を採る。**

**★`createGroup` にも同じ方式を適用する。** RPC戻り値に含まれない列を推測でリテラル記述（例：`facility_id: null`）しない、という同一の理由による。

### ①-A `createGroup`（`index.html` L1890〜）

**対象：L1975 付近の `currentGroup = { ... }` の手組み。**

現状は `result`（`create_group_with_creator` の戻り値）から `id / group_id / group_name / industry / region / expires_at / max_members` を組み立てている。

**変更内容**：手組みの直後に `group_sessions` を `select('*')` で1回取得し、取得できた行を `currentGroup` に入れる。

```
（概念）
const { data: fullGroup } = await supabase
  .from('group_sessions')
  .select('*')
  .eq('id', result.group_session_id)
  .maybeSingle();
if (!fullGroup) { showToast('グループ情報の取得に失敗しました'); return; }
currentGroup = fullGroup;
```

**必ず守ること**：

- 既存の手組みオブジェクト（`const` 宣言や `currentGroup = {...}` のプロパティ行）を**削除・改名しない**。使用されなくなる場合も定義は残し、直上に `// [EO-DEC-0200] 本オブジェクトは使用しない。既存行を削除しない条件のため定義のみ残す` のコメントを追加する
- 取得失敗時は**手組みオブジェクトへフォールバックしない**。列が欠けた `currentGroup` を業務判定に使わないため（EO-DEC-0199）。トーストを出して `return` する
- `localStorage.setItem` の順序・`currentMemberId` / `isCreator` の代入・`applyEventWording` / `applyEventUiVisibility` / `loadHome` / `showScreen` の呼び出し順を**変更しない**

### ①-B `joinGroup`（`index.html` L1996〜）★不可触関数・限定例外

**対象：`result.action === 'already_approved'` の分岐のみ（L2076〜L2093 付近）。**

この分岐だけが `currentGroup = currentGroupObj;`（L2081）を実行する。他の3分岐（`already_pending` / `rejoined` / `new_request`）は `screen-pending` へ遷移し `currentGroup` を触らないため、**変更しない**。

**変更内容**：`currentGroup = currentGroupObj;` の行を、①-A と同じ `select('*')` による取得へ置き換える。

**必ず守ること**：

- **`currentGroupObj` の定義（L2068〜L2074）を削除・改名しない。** 直上に `// [EO-DEC-0200] already_approved では group_sessions を select('*') で取り直すため本オブジェクトは使用しない。既存行は削除しない` のコメントを追加する
- **`already_approved` 以外の3分岐に一切触らない**
- この分岐内の `localStorage.setItem` 2行・`currentUser.display_name` の代入・`applyEventWording` / `applyEventUiVisibility` / `currentMemberId` / `isCreator` の代入・`loadHome` / `showScreen` / `showToast` の**順序を変更しない**
- 取得失敗時は①-Aと同じくトースト＋`return`（フォールバックしない）

**★RLSについて**：この分岐は `approved` が確定しているため `group_sessions` を読める。同じことを `checkApproval`（L2124）が既に行っている。

---

## 4. ② 共通判定関数 `isExpiryManaged()` の新設

**配置：`js/ui-helpers.js`。** `updateExpiryWarningBar` の直前に置く。`index.html` は L954 以降のインラインスクリプトから呼ぶため、L949 で読み込まれる `ui-helpers.js` に定義すれば参照できる（`window.` への明示公開は不要。既存の `updateExpiryWarningBar` と同じ形にする）。

### 責務（EO-DEC-0201）

**「このグループに1年期限制度を適用するか」だけを判定する。** 実際に期限が切れているか（`expires_at` と現在時刻の比較）は**判定しない**。期限切れの比較は呼び出し側の既存コードに残す。

### 判定条件（3条件・EO-DEC-0201 論点2）

| # | 条件 |
|---|---|
| 1 | `group_id` が `SL-` で始まる |
| 2 | `facility_id` が**厳密に** `null` |
| 3 | `archived_at` が**厳密に** `null` |

**★`plan` 列は使わない**（EO-DEC-0196 論点7）。

### 未取得（undefined）の扱い（EO-DEC-0201 論点3）

- **`== null` で `null` と `undefined` をまとめて判定しない。** `=== null` を使う
- `facility_id` または `archived_at` の**プロパティ自体が存在しない**場合は、`console.warn` を出して **`false`（期限管理の対象外）を返す**
- これは正常仕様ではなく**フェイルセーフ**である。誤って期限切れ扱いで利用者を締め出さない側へ倒す。警告が出た取得経路は修正対象

```
（概念）
function isExpiryManaged(group) {
  if (!group) return false;
  if (!('facility_id' in group) || !('archived_at' in group)) {
    console.warn('[EO-DEC-0201] isExpiryManaged: facility_id / archived_at が未取得です。取得経路の修正対象です。', group.group_id);
    return false;
  }
  if (!(group.group_id || '').startsWith('SL-')) return false;
  return group.facility_id === null && group.archived_at === null;
}
```

---

## 5. ③ 期限に関わる3経路を②へ統一する

**★3経路とも同一の `isExpiryManaged()` を呼ぶこと。適用条件を各所に書き写さない**（EO-DEC-0201）。

### ③-1 期限警告バー（`js/ui-helpers.js` `updateExpiryWarningBar` L112〜）

- 先頭の **event 用の早期 return（`if (currentGroup?.industry === 'event')`）は変更しない**（EO-DEC-0180）
- その次にある `const groupId = currentGroup?.group_id || '';` と `if (!groupId.startsWith('SL-')) { ... return; }` の**2つの処理を、`if (!isExpiryManaged(currentGroup)) { bar.style.display = 'none'; return; }` に置き換える**
- 続く `if (!currentGroup?.expires_at)` 以降・残日数の計算・表示文言・EO-DEC-0160 の文言分岐は**変更しない**

### ③-2 プロフィールの有効期限表示（`index.html` `showProfile` L4562〜）

**対象要素：`profile-expires`（L4569 で取得済みの `expiresEl`）。**

- 現状：`if (expiresEl && currentGroup?.expires_at) { ...表示... }`
- **変更後：`isExpiryManaged(currentGroup)` を条件に加える**
- **★対象外のときは行を非表示にする**（EO-DEC-0198 論点D）。現状は条件に合致しないと何もせず、L4570 でセットした `t('label_expires_loading')` の文字列がそのまま残る。したがって `else` を追加し、`expiresEl.textContent = ''` と `expiresEl.style.display = 'none'` を明示する。表示する側では `expiresEl.style.display` を元に戻すこと（グループ切替で表示・非表示が入れ替わるため）
- 残日数による色分け（7日以下＝赤・30日以下＝橙）のロジックは**変更しない**

### ③-3 期限切れ時の自動切替（`index.html` `restoreSession` L1671）★不可触関数・限定例外

**変更してよいのは、この `if` 条件の左辺1つだけ。**

- 現状：`if (currentGroup?.group_id?.startsWith('SL-') && currentGroup?.expires_at) {`
- 変更後：`if (isExpiryManaged(currentGroup) && currentGroup?.expires_at) {`
- 直上のコメント `// ST版(SL-)の期限切れチェック` は `// [EO-DEC-0201] 1年期限管理の適用対象かを共通関数で判定する` に**書き換えてよい**

**★このブロックの内部（期限比較・切替候補の取得・`switchGroup` の呼び出し・`clearEdgeOpsLocalStorage()`・`start-expiry-notice` の表示・`screen-start` への遷移）を1文字も変更しないこと。** L1682 の列指定SELECTも変更しない。

---

## 6. ④ GID伏字表示（`gid_masked`）

### ④-A 表示用共通関数 `formatGroupIdForDisplay()` の新設

**配置：`js/ui-helpers.js`（`isExpiryManaged` の隣）。**

| 入力 | 出力 |
|---|---|
| `gidMasked === true` | **`SL-●●●●●-●●●●`**（固定文字列） |
| `gidMasked === false` | GIDの実値 |
| `gidMasked` が `undefined`（未取得） | `console.warn` を出したうえで**実値**を返す（現場を止めないためのフェイルセーフ。EO-DEC-0200 により黙って `false` として扱わない） |

**★伏字の判定を各表示箇所に書かない。必ずこの関数を通す**（EO-DEC-0200）。

### ④-B プロフィール画面のGID（`index.html` 2箇所）

| 箇所 | 現状 |
|---|---|
| `loadHome` L2203 | `document.getElementById('profile-group-id').textContent = currentGroup.group_id;` |
| `showProfile` L4568 | `document.getElementById('profile-group-id').textContent = currentGroup?.group_id \|\| '---';` |

**両方とも `formatGroupIdForDisplay(currentGroup?.group_id, currentGroup?.gid_masked)` を通す。** L4568 の `|| '---'` のフォールバックは維持する。

### ④-C グループ切替モーダル（`index.html` `showGroupSwitcher`）

`.group-meta` の中でGIDを実値表示している箇所を `formatGroupIdForDisplay(g.group_id, g.gid_masked)` に置き換える。`escHtml()` は**そのまま通すこと**。

**★`.group-name` 側の `g.group_name || g.group_id` というフォールバックには触らない**（グループ名が未設定のときの表示であり、伏字対象ではない）。

### ④-D `loadMyGroups` の列追加（`index.html` L4914〜）

- `group_sessions` の `select('id, group_id, group_name, expires_at, industry')` に **`gid_masked` を追加**する
- `merged` を作る `map` の中に **`gid_masked: g?.gid_masked`** を追加する
- **期限切れ event の除外ロジック（`visible` の filter）と並び替え（`sort`）には触らない**

### ④-E 対象外（変更しない）

**`pending-group-id`（L2097 / L2108）は伏字にしない。** 本人が直前に入力したGIDの確認表示であり、伏せると自分がどのコードで申請したか分からなくなる（EO-DEC-0200 論点3）。

---

## 7. キャッシュバスターの更新（★忘れると本番に反映されない）

`index.html` **L949** の読み込みタグを更新する。

- 現状：`<script src="js/ui-helpers.js?v=20260728-2"></script>`
- 変更後：`<script src="js/ui-helpers.js?v=20260809-1"></script>`

**`js/i18n.js`・`js/image.js`・`js/templates.js`・`js/survey.js`・`js/report.js` のバージョンは変更しない**（本PRで中身を変更しないため）。

---

## 8. 完了条件（機械検証・全項目を満たすこと）

| # | 条件 |
|---|---|
| 1 | 変更ファイルが `index.html` と `js/ui-helpers.js` の**2つだけ**である |
| 2 | `js/ui-helpers.js` に `isExpiryManaged` と `formatGroupIdForDisplay` が**各1つだけ**定義されている（`index.html` 側に重複定義がない） |
| 3 | `index.html` 内に `startsWith('SL-')` を使った**期限判定が残っていない**（`isExpiryManaged` の内部を除く） |
| 4 | `js/ui-helpers.js` 内の `updateExpiryWarningBar` に `startsWith('SL-')` が残っていない |
| 5 | `isExpiryManaged` の中で `plan` を参照していない |
| 6 | `isExpiryManaged` の中に `== null` が無く、`=== null` を使っている |
| 7 | `isExpiryManaged` / `updateExpiryWarningBar` / `showProfile` / `restoreSession` の4箇所以外で `facility_id` と `archived_at` を業務判定に使っていない |
| 8 | `restoreSession` の差分が **L1671 の `if` 条件の左辺とその直上コメントのみ**である（L1682 を含め他の行の差分が0） |
| 9 | `joinGroup` の差分が **`already_approved` 分岐の内側のみ**である（他3分岐の差分が0・`currentGroupObj` の定義行の差分がコメント追加のみ） |
| 10 | `create_group_with_creator` / `join_group_with_member` を呼ぶ**引数・呼び出し方が変更されていない** |
| 11 | GIDを表示する3箇所（`profile-group-id` 2箇所・`showGroupSwitcher`）がすべて `formatGroupIdForDisplay` を通っている |
| 12 | `pending-group-id`（2箇所）の差分が**0**である |
| 13 | `loadMyGroups` の `select` に `gid_masked` があり、`merged` の map に `gid_masked` がある |
| 14 | `index.html` L949 のキャッシュバスターが更新されている |
| 15 | `signage.html`・`admin.html`・`manager.html`・`auth.js`・`styles.css`・`js/i18n.js` の差分が**0**である |
| 16 | 期限切れ event の除外ロジック（`industry !== 'event'` を含む filter）の差分が**0**である |
| 17 | 新規のSQL・migration ファイルが**追加されていない** |

---

## 9. 変更対象外とした4箇所と、その理由（★記録）

EO-DEC-0199 は当初、列指定SELECT4箇所にも `facility_id`・`archived_at` を追加するとしていた。**EO-DEC-0200 でこれを取り消した。** 理由は実コード追跡の結果、次が確認できたためである。

| 箇所 | 実際の用途 | `currentGroup` を作るか |
|---|---|---|
| `restoreSession` L1682 | 取得結果は `switchGroup(valid[0]...)` へIDを渡すだけ。`switchGroup` が `select('*')` で取り直す | **作らない** |
| `leaveGroup` L4774 | 同上 | **作らない** |
| `notifyExpiredEvents` L1754 | 期限切れ event のトースト通知用 | **作らない** |
| `updateGroupSwitcherBtn` L4633 | 切替ボタンの件数表示用 | **作らない** |

4箇所の filter はいずれも「**期限切れ event のみ除外**」であり、本PRの1年期限管理とは別の判定である。列を足しても `isExpiryManaged()` の入力にはならない。**必要な場所だけを変更することで、Batch5 の切り戻し単位を小さく保つ。**

---

## 10. ロールバック

**マージ前に必ずタグ `pre-batch5` を打つ。GitHub Release の label は必ず `None`。**

DB変更が無いため、問題発生時はコードを当該タグへ戻すだけで完結する。Edge Function の Deploy も不要。

---

## 11. 実機確認（野口さん・マージ後）

**★`社員⭐︎`（顧客本番）では実機確認・投稿・退出を一切行わない。**

### A. 通常グループの回帰（★最優先・第0章 最優先制約）

**フロント3（`SL-5M7UZ-KSAG`・`facility_id` なし）**で確認する。

| # | 確認項目 | 期待 |
|---|---|---|
| 1 | 起動（リロード）してホームが出る | 従来どおり |
| 2 | プロフィール画面の「有効期限：◯（残り◯日）」 | **従来どおり表示される** |
| 3 | 期限警告バー（残り30日以内の場合） | 従来どおり |
| 4 | プロフィールのGID | **実値が表示される** |
| 5 | グループ切替モーダルのGID | **実値が表示される** |
| 6 | 投稿・既読・グループ切替・引き継ぎ | 従来どおり |
| 7 | グループ新規作成 → ホーム表示 | 成功する |
| 8 | 別グループへ参加申請 → 承認 → 切替 | 成功する |

### B. 施設配下グループ

**江の島フットボールクラブ2（`SL-ARGFF-N2R4`）**で確認する。

| # | 確認項目 | 期待 |
|---|---|---|
| 9 | プロフィール画面の有効期限 | **行が消えている**（「読込中」も残らない） |
| 10 | 期限警告バー | **出ない** |
| 11 | 投稿・既読・メンバー一覧 | 従来どおり動く |

### C. アーカイブ済み・GID伏字

**テスト施設グループB改（`SL-7E2D7-7VXT`・`gid_masked=true` の唯一のグループ）**で確認する。

| # | 確認項目 | 期待 |
|---|---|---|
| 12 | プロフィールのGID | **`SL-●●●●●-●●●●`** |
| 13 | グループ切替モーダルのGID | **`SL-●●●●●-●●●●`** |
| 14 | 秀作（グループ管理者）で見ても伏字か | **伏字**（管理者にも伏せる） |
| 15 | 有効期限 | **表示されない**（アーカイブ済みのため） |

### D. コンソール

| # | 確認項目 | 期待 |
|---|---|---|
| 16 | 上記A〜Cの全操作中、`[EO-DEC-0201] isExpiryManaged` の警告 | **1件も出ない**（出たら取得経路の漏れ＝要修正） |
| 17 | `formatGroupIdForDisplay` の警告 | **1件も出ない** |

---

## 12. 参考：本PRで新設する関数（2本）

| 関数 | 場所 | 責務 |
|---|---|---|
| `isExpiryManaged(group)` | `js/ui-helpers.js` | 1年期限制度の**適用対象か**だけを返す。期限切れ判定はしない |
| `formatGroupIdForDisplay(groupId, gidMasked)` | `js/ui-helpers.js` | 表示用GID文字列を返す |

以上。
