# EdgeOps 実装指示書：screen-join-only（他のグループに参加）の静的併記化

**版**：v1.0 ／ **作成**：2026/7/28
**根拠判定**：第165回（EO-DEC-0165・条件付きGO）
**実施予定**：2026/7/29夜（8/1予定を野口判断で前倒し・実施内容は判定どおり）
**切り戻しタグ**：マージ前に `pre-joinonly-wording` を作成すること

> **行番号について**：本書の行番号は 2026/7/28 反映後の `index.html`（4,696行・commercial追加済み）に基づく実測値。編集で前後するため、**行番号ではなく要素・キー名・完全一致文字列で対象を特定すること。**

---

## 0. 変更対象ファイル（この2つ以外は1文字も変更しないこと）

| # | ファイル | 変更内容 |
|---|---|---|
| 1 | `index.html` | EVENT_I18N_PAIRSから2組削除・screen-join-only内の文言3箇所・i18n.jsキャッシュクエリ更新 |
| 2 | `js/i18n.js` | 既存2キーの文言変更（ja/en）。**キーの追加・削除はしない** |

**変更禁止**：`applyEventWording()` 本体／`onIndustryChanged()` 本体／screen-start側のE2差し替え（form_group_id_join等の残り7組）／DB／RPC／L3／`signage.html`／`admin.html`／`js/` 配下の他ファイル／`auth.js`。新規JSファイルを作成しない。ローカル関数のグローバル昇格をしない。

## 1. 最優先制約

実顧客が本番稼働中である。screen-start（起動画面）の新規作成・参加フォームにおけるevent文言差し替え（業種プルダウンでeventを選ぶと「イベントコード」等へ変わる挙動）は**現状のまま維持**すること。今回変更するのはscreen-join-only専用キーのみ。

## 2. 変更内容

### 2-1. index.html：EVENT_I18N_PAIRSから2組を削除

対象（L1001〜）：`const EVENT_I18N_PAIRS = [` の配列から、次の**2行だけ**を削除する。

```js
  ['desc_group_id_join',     'desc_group_id_join_event'],
  ['form_group_id',          'form_group_id_event'],
```

削除後の配列は7組（heading_create_group／form_group_id_join／label_applied_group_id／label_your_group_id／form_group_name／btn_create_group／btn_join）になること。**他の7組の順序・内容は変更しない。**

### 2-2. index.html：screen-join-only内の文言3箇所（HTML既定文言も同期）

`<div class="screen" id="screen-join-only">` ブロック内のみ。

1. 見出し（L337・data-i18n無しの静的div）：
   - 変更前：`参加したいグループのIDを入力してください`
   - 変更後：`参加したいグループIDまたはイベントコードを入力してください`
2. 説明（L338・`data-i18n="desc_group_id_join"` のdiv内テキスト）：
   - 変更前：`グループの管理者から共有されたIDを入力します`
   - 変更後：`グループ管理者またはイベント主催者から共有されたID・コードを入力します`
3. ラベル（L347・`data-i18n="form_group_id"` のlabel内テキスト）：
   - 変更前：`グループID`
   - 変更後：`グループID／イベントコード`

※2・3はapplyLang()で上書きされるが、初期表示のちらつき防止のためHTML既定文言もi18n値と同期させる（既存流儀）。
※見出し（1）の`data-i18n`化は**行わない**（第165回条件・8/10のJA/EN切替実装で扱う）。

### 2-3. js/i18n.js：2キーの文言変更（ja/en・キー追加削除なし）

ja側：
```js
    form_group_id:              'グループID／イベントコード',
    desc_group_id_join:         'グループ管理者またはイベント主催者から共有されたID・コードを入力します',
```

en側：
```js
    form_group_id:              'Group ID / Event Code',
    desc_group_id_join:         'Enter the ID or code shared by the group admin or event organizer.',
```

**`form_group_id_event` / `desc_group_id_join_event` は未使用になるが、削除せずそのまま残置すること**（累積温存・第165回条件）。

### 2-4. index.html：キャッシュクエリ更新

i18n.jsの読込行（L922）を更新する：
- 変更前：`js/i18n.js?v=20260727-1`
- 変更後：`js/i18n.js?v=20260729-1`

他のスクリプトの`?v=`は変更しない。

## 3. PR差分の期待値（レビュー用）

- 変更ファイルが `index.html` と `js/i18n.js` の**2ファイルのみ**であること（他ファイルが含まれていたら実装漏れ・過剰のいずれか）
- index.html：削除2行（PAIRS）＋文言3箇所＋キャッシュクエリ1行。行数は4,696→4,694
- js/i18n.js：2キー×ja/en＝4行の文言変更のみ。行数不変

## 4. 実機確認（マージ後・テスト用グループで・社員⭐︎では行わない）

1. 通常グループ所属中に「他のグループに参加」を開く→見出し・ラベル・説明が併記表記
2. **eventグループ所属中**に同画面を開く→同じ併記表記（「イベントコード」への逆流が起きない）
3. screen-startの業種プルダウンでeventを選ぶ→従来どおりイベントコード等へ差し替わる／通常業種へ戻すとグループID表記へ戻る（E2回帰）
4. 同画面から通常グループへの参加申請が従来どおり成功する
5. 言語ENで同画面を開く→ラベル'Group ID / Event Code'・説明が英語併記文になる（見出しは日本語のまま＝仕様どおり）

## 5. 事後の文書追い付き（実装・実機確認後に別途）

- ST版イベント催事モード仕様書 第5章へ「screen-join-onlyは静的併記・差し替え対象外（第165回）」を追記
- スケジュールへ実績記載（7/28判定取得・7/29夜実装）
