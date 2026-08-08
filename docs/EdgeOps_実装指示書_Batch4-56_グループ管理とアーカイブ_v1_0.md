# EdgeOps 実装指示書：Batch4-⑤⑥（グループ管理・アーカイブ）v1.0

2026/8/8 ／ 江の島エッジ合同会社
根拠：**EO-DEC-0196**（9論点・条件付きGO）／**EO-DEC-0197**（論点4の上書き・条件付きGO）

---

## 0. 変更対象と変更禁止領域

| | |
|---|---|
| **変更してよいファイル** | **`manager.html` のみ** |
| **変更禁止** | `index.html` ／ `signage.html` ／ `admin.html` ／ `auth.js` ／ `styles.css` ／ `js/` 配下すべて |
| **DB変更** | **なし。** RPCは8/7作成済み（migration_log id=78）。SQLを書かない・RPCを作らない・列を足さない |

**新しいCSSクラスは `mg-` 接頭辞にする。** `styles.css` の既存クラス名を再定義しない。`styles.css` の `:root` に実在するCSS変数は33個のみ。`--eo-space-4` は 16px。**`--eo-space-8` / `--eo-space-16` / `--eo-space-24` / `--eo-space-32` は存在しない。**

---

## 1. 使用するRPC（6本・すべて作成済み・引数名は厳密に一致させること）

```
manager_create_group(p_facility_id uuid, p_group_id text, p_group_name text,
                     p_industry text, p_display_name text)
manager_rename_group(p_group_session_id uuid, p_group_name text)
manager_archive_group(p_group_session_id uuid)
manager_unarchive_group(p_group_session_id uuid)
manager_reissue_group_gid(p_group_session_id uuid, p_new_group_id text)
manager_change_group_owner(p_group_session_id uuid, p_new_owner_eo_uid text)
```

**6本とも 2026/8/8 に ROLLBACK 付き本体試験を実施し、全本正常終了を確認済み。**

---

## 2. 共通実装原則（Batch4-④で確立・必ず適用する）

1. **書き込み中はセクション内の全ボタンを `disabled` にする。** 同一ボタンの `disabled` だけでは、再描画でリストが繰り上がったときに「押した座標に別人のボタンが来る」事故を防げない
2. **解除は必ず `finally` に集約する**
3. **確認ダイアログには対象グループ名を明示する**（破壊的でない操作にも出す）
4. **書き込み後は読取RPCを再取得し、DB確定状態から再描画する**（ローカル状態を書き換えない）

**既存の `addFacilityManager()`（manager.html L927付近）とまったく同じ構造で書くこと。** `setManagerSectionButtonsDisabled()` に相当する関数をグループ側にも用意する（例：`setGroupSectionButtonsDisabled()`）。

---

## 3. 実装する機能

### 3-1　グループ作成

`renderGroupList()` のグループ一覧の上に「グループを作成」ボタンを置く。押すと入力欄を開く。

**入力項目**：グループ名（必須）／業種（必須・プルダウン）／作成者としての表示名（必須）

**業種の選択肢は既存の `INDUSTRY_LABELS` を使う。** ただし **`event` は選択肢から除外する。** イベント催事モードはST版の機能であり、Plus版施設配下での扱いは9/14に別途決める（スケジュールv67 9/14行）。

**GIDはフロントで採番する。** 次の関数を `manager.html` 内に**新規に定義**する（EO-DEC-0196 論点5・案ア）。

```js
function generateGroupId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part1 = Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  const part2 = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `SL-${part1}-${part2}`;
}
```

**`js/ui-helpers.js` を読み込んではならない。** この6行は意図した重複である。

RPC呼び出し：

```js
await sb.rpc('manager_create_group', {
  p_facility_id: facilityId,
  p_group_id: generateGroupId(),
  p_group_name: groupName,
  p_industry: industry,
  p_display_name: displayName,
});
```

**★作成者（＝操作した施設管理者本人）が、そのグループの管理者として参加します。** 作成前の確認に次を明示する。

> 「（グループ名）」を作成します。
> 作成すると、あなたがこのグループの管理者として参加します。

### 3-2　グループ名の変更

各グループ行に「名前を変更」。現在名を初期値に入れた入力欄を出す。空文字は送らない（RPCが `INVALID_INPUT` を返す）。

### 3-3　アーカイブ

**EO-DEC-0196 論点2・案ウ。確認文言は条件であり、必ずこのとおり出すこと。**

> 「（グループ名）」をアーカイブします。
> 現在（N）人が参加しています。
> **アーカイブ後も現場メンバーは引き続きこのグループを利用できます。**

**（N）には `manager_list_groups()` の `member_count` を使う。** `manager_unarchive_group` の戻り値 `member_count_before` は**画面に表示しない**（サイネージ端末を含む別集計であり、一覧の人数と食い違うため）。

**今回のアーカイブは「利用停止」ではない。** 施設管理画面上で現役一覧から外して整理する機能である。UIに「停止」「無効化」「利用できなくなります」と書いてはならない。

### 3-4　アーカイブからの復帰

既存の「アーカイブ済み（N）」`<details>` 内の各行に「復帰」を置く。

**戻り値 `creator_seeded_member_id` が null でない場合、次を表示する**（EO-DEC-0196 論点3の条件）。

> グループに管理者がいなかったため、あなたをグループ管理者として登録しました。

復帰時は施設のアクティブグループ数が20を超えると `FACILITY_GROUP_LIMIT` になる。

### 3-5　GID再採番

**この操作は元に戻せない。** 押すと新GIDへ付け替わり、同時に `gid_masked` が true になる（分離不可・解除RPCは存在しない）。

**確認文言は条件。必ずこのとおり出すこと**（EO-DEC-0196 論点1）。

> 「（グループ名）」のグループIDを再発行します。
> 現在のグループID（現GID）は使えなくなります。
> 一般の利用者には新しいグループIDが伏字で表示されます。
> **この操作は元に戻せません。**

新GIDは `generateGroupId()` で採番して `p_new_group_id` に渡す。RPC側の形式検証は `^SL-[A-Z0-9]{5}-[A-Z0-9]{4}$` であり、同関数の出力はこれに適合する。

成功後、一覧のGID表示を新しい値に更新する（読取RPC再取得で自動的に反映される）。

### 3-6　グループ管理者の追加

**EO-DEC-0197。UIに「所有者変更」「譲渡」と書いてはならない。「グループ管理者を追加」で統一する。**

各グループ行に「管理者を追加」。押すと、そのグループの `approved` メンバーから選ぶ一覧を出す。

**候補の取得元**：`manager_list_member_candidates()`（`out_` 接頭辞・5列）。すでに `memberCandidates` に読み込まれている。

確認文言：

> 「（対象者名）」をグループ管理者に追加します。
> **追加後もあなたは引き続きこのグループの管理者です。**

RPC が返す例外の扱いは第4章のとおり。

### 3-7　管理者名の表示（変更不要）

**`buildGroupRow()`（manager.html L659付近）はすでに `creator_names[]` を「、」区切りで全員表示している。** 複数管理者になっても自動的に全員並ぶ。**この箇所は変更しない**（EO-DEC-0197 付帯条件3は実装済み）。

### 3-8　プレースホルダーの削除

`renderGroupList()` 末尾の次の行を**削除する**。

```js
note.textContent = 'グループごとの管理操作は Batch4-⑤ で実装します';
```

`.mg-group-note` を他に使っていなければ、生成箇所ごと削除してよい。

---

## 4. エラーメッセージ（日本語化）

既存の `MANAGER_ERROR_MESSAGES` と `managerErrorMessage()` の方式をそのまま使い、次を**追加**する。

```js
DUPLICATE_GROUP_ID:          'グループIDが重複しました。もう一度お試しください',
FACILITY_GROUP_LIMIT:        'この施設のグループ数が上限（20）に達しています',
GROUP_NOT_FOUND:             'グループが見つかりません',
ALREADY_ARCHIVED:            'このグループはすでにアーカイブされています',
NOT_ARCHIVED:                'このグループはアーカイブされていません',
NOT_AUTHORIZED:              '権限がありません',
INVALID_GID_FORMAT:          'グループIDの形式が正しくありません',
SIGNAGE_CANNOT_BE_OWNER:     'サイネージ端末はグループ管理者にできません',
ALREADY_OWNER:               'この方はすでにこのグループの管理者です',
FACILITY_NOT_FOUND:          '施設が見つかりません',
```

`TARGET_NOT_APPROVED_MEMBER` と `NOT_FACILITY_MANAGER` は既存の定義をそのまま使う。

**★`SIGNAGE_CANNOT_BE_OWNER` は、通常のUI操作では到達しない。** `manager_list_member_candidates()` が `is_signage` を除外しているため、サイネージ端末は候補一覧に現れない。**それでも定義を残す。** RPCを直接呼ばれた場合の二重防御にあたる（EO-DEC-0197 の確認事項）。

---

## 5. 変更してはならないもの

- **`index.html` に一切触れない。** `gid_masked` の伏字表示と期限管理の2条件化は **Batch5（8/13）** で行う
- **`manager_list_groups()` に列を追加しない**（管理者人数専用の列は不要・EO-DEC-0197）
- **`js/ui-helpers.js` を読み込まない**
- **RPCを新規作成・変更しない**
- **`group_sessions` / `group_members` / `messages` へ直接SQLを書かない**

---

## 6. 実機確認項目

**★`社員⭐︎`（顧客本番）では一切実施しない。** 対象は施設「江の島エッジ合同会社」（`FL-EEE-0001`）と、その配下の「江の島フットボールクラブ2」（`SL-ARGFF-N2R4`）。

| # | 確認内容 | 期待 |
|---|---|---|
| 1 | グループを作成する | 一覧に増える。作成者（自分）が管理者として表示される |
| 2 | 業種プルダウン | **`event` が選択肢に無い** |
| 3 | 2グループを連続して作成する | **2件とも正常に作成でき、それぞれ異なるGIDが付与される**。万一ランダム衝突した場合は `DUPLICATE_GROUP_ID` の日本語メッセージが出れば正常。**自動再試行は実装しない** |
| 4 | グループ名を変更する | 一覧の名前が変わる |
| 5 | アーカイブの確認画面 | 人数と「**引き続き利用できます**」が出る |
| 6 | アーカイブする | 一覧から消え「アーカイブ済み」に入る |
| 7 | **アーカイブ後にスマホの index.html を開く** | **そのグループが今までどおり使える**（仕様どおり） |
| 8 | 復帰する | 現役一覧に戻る |
| 9 | GID再採番の確認画面 | 「**元に戻せません**」が出る |
| 10 | GID再採番を実行する | 一覧のGIDが変わる |
| 11 | 管理者を追加する（三郎） | **管理者欄が「秀作、三郎」の2名になる** |
| 12 | 管理者追加の候補一覧を開く | **サイネージ端末（五郎・サイネージ端末デモ用）が候補に表示されない**。表示された場合は実装せず報告する |
| 13 | 書き込み中の連打 | セクション内の全ボタンが無効になる |
| 14 | プレースホルダー | 「Batch4-⑤ で実装します」が**消えている** |
| 15 | **ST版の回帰**（江の島フットボールクラブで投稿・既読・グループ切替） | **不変** |

**★項目7が最重要。** アーカイブしても現場が使えることを、仕様として実機で確認する。ここで「使えなくなっている」なら、`index.html` に想定外の参照があることになるため直ちに報告する。

---

## 7. 完了後に必要な文書反映（Copilot作業外）

- 設計書：複数creator仕様・`manager_change_group_owner` の実体と名称の不一致・GID再採番の一方通行・アーカイブの定義・`plan` は予約列・`is_creator` 経路の正式化・`audit_logs.actor_role` に表示名
- 残課題：①施設管理者が自身のcreator権限から安全に離脱する手段（creator 0人にならない保証を含む・Plus版リリース前に要否判定）②アーカイブ済みグループの現場側での扱い（Plus版リリース前に別判定）
- Batch5へ引き継ぐ：**期限管理は2条件**（`facility_id IS NULL AND archived_at IS NULL`）／**`gid_masked` の伏字表示を `index.html` に追加**
