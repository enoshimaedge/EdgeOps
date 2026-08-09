# EdgeOps 判定依頼書 第201回（EO-DEC-0201）

**件名：Batch5 ①「取得経路の列統一」の対象範囲の縮小と、不可触関数 `joinGroup` への最小変更の可否**

- 起案：Web Claude ／ 決裁：野口秀作
- 日付：2026/8/9（連休3日目・Batch5 当日）
- 前提判定：第187回（Batch5）／第196回（Batch4-⑤⑥）／第198回（施設グループの識別表示）／**第199回（`currentGroup` の取得経路と期限判定の共通化）**
- 実コード確認日時：2026/8/9 昼・`raw.githubusercontent.com`（`enoshimaedge/EdgeOps` main）
- 対象ファイル：`index.html`（5,109行）／`js/ui-helpers.js`（513行）

---

## 0. なぜこの判定が要るか（3行）

第199回で「6箇所へ `facility_id`・`archived_at` を追加する」とGOを得た。**実装指示書を書くために6箇所の使われ方を実コードで追ったところ、うち4箇所は `currentGroup` を作らないことが判明した。** また残る2箇所のうち1箇所は**不可触関数 `joinGroup` の内部**である。第199回は行番号ベースで論点を立てたため、この2点が判定書に現れていない。

---

## 1. 第199回で決めたこと（原文の要旨）

> 案ア（取得側を揃える）。手組み2箇所（L1975 グループ作成直後／L2081 参加承認直後）と列指定SELECT4箇所（L1682／L1754／L4633／L4774）に `facility_id`・`archived_at` を追加（L2081 には `expires_at` も）。`group_sessions(*)` の5経路は変更しない。★`undefined` をST版相当として業務判定に使わない。

---

## 2. 実コードで判明した事実

### 2-1. 6箇所が属する関数

| 行 | 属する関数 | `currentGroup` を作るか |
|---|---|---|
| L1975 | `createGroup`（L1890〜） | **作る**（手組み） |
| L2081 | **`joinGroup`（L1996〜）＝不可触関数** | **作る**（手組み） |
| L1682 | **`restoreSession`（L1591〜）＝不可触関数** | 作らない |
| L1754 | `notifyExpiredEvents`（L1749〜） | 作らない |
| L4633 | `updateGroupSwitcherBtn`（L4625〜） | 作らない |
| L4774 | `leaveGroup`（L4711〜） | 作らない |

### 2-2. 列指定SELECT4箇所が `currentGroup` を作らない根拠

- **L1682（`restoreSession`）**：取得した `rest` は `valid[0]` を選んで `switchGroup(valid[0].group_session_id, valid[0].id)` に渡すだけ（L1693-1695）。`switchGroup` は内部で `group_sessions` を `select('*')` で取り直す。**列を足しても `currentGroup` には到達しない。**
- **L4774（`leaveGroup`）**：同じく `switchGroup` へ ID を渡すだけ。
- **L1754（`notifyExpiredEvents`）**：期限切れ event のトースト通知用。`currentGroup` を触らない。
- **L4633（`updateGroupSwitcherBtn`）**：切替ボタンの**件数**表示用。`currentGroup` を触らない。

4箇所の `filter` はいずれも「**期限切れ event のみ除外**」（EO-DEC-0163／0180／0181）であり、**Batch5 ②で作る「期限管理の対象か」の判定とは別の判定**である。前者は event の終了判定、後者はST版1年期限の適用対象判定。

### 2-3. `restoreSession` の主経路は既に全列を持っている

`restoreSession` の主クエリは `select('*, group_sessions(*))`（L1594）、rejected フォールバックも `group_sessions(*)`（L1615）。**`currentGroup` は `facility_id`・`archived_at` を既に持っている。**

### 2-4. したがって

**`currentGroup` に列が欠けるのは、手組み2箇所（`createGroup` L1975・`joinGroup` L2081）だけである。**

---

## 3. 論点1：列追加の対象を手組み2箇所へ縮小してよいか

### 案ア（起案推奨）：手組み2箇所に限定する

| 対象 | 追加する列 |
|---|---|
| `createGroup` L1975 | `facility_id`・`archived_at` |
| `joinGroup` L2081 | `facility_id`・`archived_at`・`expires_at` |

列指定SELECT4箇所は**変更しない**。

**理由**：第199回の趣旨は「判定へ渡すデータの形を揃える」（8/8作法5）。データの形が問題になるのは `currentGroup` を作る経路だけであり、4箇所は形の問題を持たない。変更しないことで、不可触関数 `restoreSession` に触る必要が消え、`leaveGroup`・`notifyExpiredEvents`・`updateGroupSwitcherBtn` の既存の event 除外ロジックにも触らずに済む。**Batch5 の切り戻し単位が小さくなる。**

**懸念**：将来、切替候補の絞り込みでも「期限管理の対象か」を見たくなった場合、その時点で列追加が要る。ただしそれは新しい要求であり、今日の実装で先取りする理由はない。

### 案イ：第199回どおり6箇所すべてに追加する

**理由**：形を全経路で揃えておけば将来の分岐が減る。
**問題**：`restoreSession`（不可触）に触る必要が生じる。効果は現時点でゼロ。

### 案ウ：4箇所は追加せず、`switchGroup` 側にコメントだけ残す

案アに「なぜ足さないか」の1行コメントを添える案。案アに含めてよい。

**★判定を求める点：案ア・案イ・案ウのいずれか。**

---

## 4. 論点2：不可触関数 `joinGroup` への最小変更を認めるか

案アを採っても、**`joinGroup`（不可触）への変更は残る**（L2081 の手組みオブジェクトは `currentGroup` そのものになるため）。

### 現状のコード（L2068-2074）

```
      group_id: result.group_id,
      group_name: result.group_name,
      industry: result.industry,
      region: result.region
    };
```

### 変更後（案ア-1・起案推奨）

`region` の次に3行を足すのみ。**既存4行は1文字も変更しない。**

```
      region: result.region,
      expires_at: result.expires_at,
      facility_id: result.facility_id,
      archived_at: result.archived_at
    };
```

### ★前提の確認が必要な事項

**`join_group_with_member` RPC（不可触RPC）の戻り値 jsonb に `expires_at`・`facility_id`・`archived_at` が含まれているか未確認。** 含まれていなければ、

- **案ア-1**：RPC は触らず、`joinGroup` 内で `group_sessions` を1回 `select('*')` して `currentGroup` に入れる（手組みをやめる）。**不可触RPCを変更しない代わりに、クエリが1本増える**
- **案ア-2**：`join_group_with_member` の戻り値に3列を足す（**不可触RPCの変更＝原則違反。推奨しない**）

**★本依頼書の提出前に、野口さんに `join_group_with_member` の本体をDBで確認していただく。**（作法：RPCは名称を信用せず本体を読む）

### 代替案（不可触に一切触らない）

**案エ**：`joinGroup` の外側、`await loadHome()` の直前で `currentGroup` を補完する処理を挟む。
**問題**：補完処理を呼ぶ1行を `joinGroup` 内に足すことになり、結局 `joinGroup` を変更する。**不可触を回避できない見せかけの案であり、推奨しない。**

**★判定を求める点**：
1. 不可触関数 `joinGroup` に対し、**「オブジェクトリテラルへの列追加のみ・既存行の変更ゼロ・ロジック不変」に限定した変更**を認めるか。
2. 認める場合、RPC戻り値に列が無いときは**案ア-1（`select('*')` で取り直す）**でよいか。

---

## 5. 論点3：GID伏字（`gid_masked`）の適用範囲

第196回 論点1で「`gid_masked=true` 固定・解除RPCなし」とGOを得たが、**`index.html` 側の適用箇所が確定していない。** 実コードでGIDを実値表示している箇所は次のとおり。

| 箇所 | 要素／関数 | 起案 |
|---|---|---|
| プロフィール画面 | `profile-group-id`（`loadHome` L2203／`showProfile` L4568） | **伏字にする** |
| **グループ切替モーダル** | `showGroupSwitcher` の `.group-meta` | **伏字にする**（野口さん決裁済み・案ア） |
| 参加申請中画面 | `pending-group-id`（L2097／L2108） | **対象外**（本人が直前に入力した値のエコーであり、伏せても意味がない） |

**★切替モーダルを伏字にする場合、`loadMyGroups`（L4927）の列指定SELECTに `gid_masked` の追加が必要。** 第199回の4箇所には含まれていない5箇所目である。`loadMyGroups` は不可触関数ではない。

### 起案する仕様

- **表示形式**：`SL-●●●●●-●●●●`（`SL-` と桁構造は残す）
- **対象者**：**グループ管理者（`is_creator`）にも伏せる。** 実値が見えるのは `manager.html`（施設管理者）だけ
  - 理由：伏字の目的は、再発行後のGIDが現場アプリの画面から再び出回るのを防ぐこと。管理者に見せると目的を達しない
- `gid_masked` が `false` または未取得のときは**従来どおり実値**を表示

**★判定を求める点**：表示形式・対象者（管理者にも伏せる）・`pending-group-id` を対象外とすること・`loadMyGroups` への列追加の4点。

---

## 6. 影響範囲とリスク

| | |
|---|---|
| 変更ファイル | `index.html`・`js/ui-helpers.js`（②の共通判定関数） |
| DB変更 | **なし**（`gid_masked` 列は8/7のBatch1で追加済み） |
| L3保護領域 | **触らない**（`group_sessions`／`group_members`／`messages` への直接変更なし） |
| 不可触RPC | **触らない**（案ア-1を採る場合） |
| 不可触関数 | **`joinGroup` のみ・列追加に限定**（`restoreSession` は案アなら触らない） |
| ST版への影響 | 施設配下グループが本番に1件のみ（江の島フットボールクラブ2）。他34グループは `facility_id IS NULL` のため**従来どおりの挙動** |

### ロールバック

マージ前に **タグ `pre-batch5`**（GitHub Release の label は **None**）。問題発生時は当該タグへ戻す。DB変更が無いためコードの戻しだけで完結する。

---

## 7. 検証（実データが存在するもの）

| 対象 | 使えるグループ |
|---|---|
| 施設配下＝期限行の非表示 | 江の島フットボールクラブ2（`SL-ARGFF-N2R4`・`facility_id` あり） |
| アーカイブ済み＝期限管理の対象外 | テスト施設グループA（`SL-7BB9N-YNER`）／B改（`SL-7E2D7-7VXT`） |
| **GID伏字** | **テスト施設グループB改（`SL-7E2D7-7VXT`）＝`gid_masked=true` の唯一のグループ** |
| ST版の回帰（従来どおり期限表示） | フロント3（`SL-5M7UZ-KSAG`・`facility_id` なし） |

★`社員⭐︎`（顧客本番）では実機確認・投稿・退出を一切行わない。

---

## 8. 判定を求める事項（まとめ）

| # | 論点 | 起案 |
|---|---|---|
| 1 | 列追加の対象を**手組み2箇所へ縮小**してよいか（第199回の6箇所からの縮小） | **案ア** |
| 2 | 不可触関数 `joinGroup` への**列追加限定・ロジック不変**の変更を認めるか | **認める** |
| 2-b | RPC戻り値に列が無い場合の代替 | **案ア-1（`select('*')` で取り直す）** |
| 3 | GID伏字の表示形式・対象者・適用箇所・`loadMyGroups` への列追加 | 本文5のとおり |

以上。
