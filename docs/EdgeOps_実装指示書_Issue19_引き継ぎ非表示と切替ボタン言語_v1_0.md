# EdgeOps 実装指示書 Issue⑲
## A：引き継ぎ機能の非表示（第13章・スマホ側） ／ B：グループ切替ボタンの言語追従修正

**版**：v1.0 ／ **作成**：2026/7/27
**根拠**：A＝仕様書 v1.7 **第13章**（確定済み仕様。スマホ側は未着手だったもの）
　　　　　B＝表示不具合の修正（第157回「翻訳漏れは不具合修正として扱う」の扱いに準拠）
**正本**：`EdgeOps_ST版イベント催事モード仕様書_v1_7.docx`
**前提**：Issue⑭（PR #71）マージ済み・本番稼働中

> **行番号について**：本書の行番号は **2026/7/27 マージ後の main** に基づく実測値。
> ただし編集で前後するため、**行番号ではなく関数名・要素IDで対象を特定すること。**

---

## 0. 絶対条件（最優先）

> ### 通常グループ（`industry !== 'event'`）の既存挙動を、一切変更しないこと。

- A の非表示は **event グループの全員（主催者・一般参加者・両方）** に適用する。
  **判定には `currentGroup?.industry === 'event'` を使うこと**（`isEventGeneralMember()` ではない）。
- `handover_notes` / `handover_confirmations` のデータ・集計・クエリには触れない。**表示制御のみ**。
- 既読集計ロジック／`realReadMap`／`read_receipts`／`receiver_count`／`item_receivers` に触れない。
- L3保護領域（`group_sessions` / `group_members` / `messages`）のスキーマに触れない。
- `js/i18n.js` は**変更しない**（本Issueで文言キーの追加・変更は無い。`btn_switch_group` は ja/en とも既存）。

---

## 1. 変更対象ファイル（この2つ以外を変更しないこと）

| # | ファイル | 変更内容 |
|---|---|---|
| 1 | `index.html` | A-1〜A-4・B・**`ui-helpers.js` のキャッシュクエリ更新（1行のみ）** |
| 2 | `js/ui-helpers.js` | `updateHandoverBadge()` 冒頭ガード |

**変更してはならないファイル**：`js/i18n.js`、`signage.html`、`js/auth.js`、`js/image.js`、`js/templates.js`、`js/survey.js`、`js/report.js`、`styles.css`、`admin.html`、`supabase/functions/` 配下すべて

---

## 2. A. 引き継ぎUIの非表示（仕様書 第13章）

第13章：「event モードでは引き継ぎ機能（引き継ぎタブ・一覧・作成ボタン・詳細）を表示しない。screen-handover を復元対象から外し、event で screen-handover に戻ろうとした場合は screen-home に戻す。」

### A-1. 共通関数 `applyEventUiVisibility()` を追加

`index.html` の `applyEventWording()`（L1002）の**直後**に定義する。

```js
// ── [第13章] event では引き継ぎ機能を表示しない（主催者を含む全員） ──
function applyEventUiVisibility() {
  const ev = currentGroup?.industry === 'event';
  const chipHandover = document.getElementById('filter-chip-handover');
  const chipAll      = document.getElementById('filter-chip-all');
  if (chipHandover) chipHandover.style.display = ev ? 'none' : '';
  if (chipAll)      chipAll.style.display      = ev ? 'none' : '';
  if (ev) {
    const bar = document.getElementById('handover-badge-bar');
    if (bar) bar.style.display = 'none';
    if (homeFilter !== 'msg') setHomeFilter('msg');
  }
}
```

- 対象要素：`filter-chip-handover`（L437）・`filter-chip-all`（L438）・`handover-badge-bar`（L427）
- **通常グループでは display '' を再設定するだけ**（見た目は不変）。event→通常のまたぎ切替時にタブを復元するために必要（PR2 の else 復元と同じ考え方）。

### A-2. 呼び出し箇所（5箇所）

`applyEventWording(currentGroup?.industry === 'event');` の**直後**に `applyEventUiVisibility();` を1行追加する。

- 対象は**引数が `currentGroup?.industry === 'event'` の呼び出しすべて**（現行 L1561・L1658・L1792・L1885・L4426 の5箇所）。
- **`onIndustryChanged()` 内の `applyEventWording(isEvent)`（L1019・作成画面用）には追加しないこと。** 作成画面には `currentGroup` が無い。

### A-3. `setHomeFilter()` にガードを追加

`async function setHomeFilter(f) {`（L2329）の**冒頭**に追加する。

```js
  // [第13章] event では引き継ぎ・すべてタブを使用しない
  if ((f === 'handover' || f === 'all') && currentGroup?.industry === 'event') f = 'msg';
```

これにより第127回のタブ復元経路（`restoreLastMajorScreen()` 内の `setHomeFilter(lastFilter)`）も同時に塞がる。

### A-4. `restoreLastMajorScreen()` の復元対象から外す

`if (last === 'screen-handover')` 分岐（L4330-4332）を次のとおり変更する。

```js
    if (last === 'screen-handover') {
      if (currentGroup?.industry === 'event') {
        // [第13章] event は screen-handover を復元せず home に留まる
      } else {
        showScreen('screen-handover');
        return;
      }
    }
```

**`screen-profile` の分岐と、その下のタブ復元処理は変更しないこと。**

### A-5. やらないこと（スコープ外）

- `showScreen()` 本体・画面記録処理（L4269-4280）は変更しない。侵入経路（タブ・バッジ・「すべて見る」リンク）は A-1〜A-3 ですべて閉じ、復元は A-4 で塞がるため。
- 引き継ぎ詳細内の名簿非表示は **PR2 実装済み**（第157回 論点C）。触れない。

---

## 3. B. グループ切替ボタンの言語追従修正

**症状**：English に切り替えたあと日本語へ戻しても、`#group-switch-btn` が "Switch group (N)" のまま残る。

**原因（実コード確認済み）**：`#group-switch-btn`（L741）は `data-i18n` を持たず、`updateGroupSwitcherBtn()`（L4077）が `t('btn_switch_group')` ＋件数を `textContent` で直接描画している。そのため `applyLang()` の書き換え対象にならず、言語切替時に再描画されない。

**修正**：`setLang()`（L936）内の `renderMessages();` の**直後**に1行追加する。

```js
  updateGroupSwitcherBtn();  // [不具合修正] data-i18n 非対象のため言語切替時に再描画する
```

**ボタンに `data-i18n` を付与する方式は不採用**（`applyLang()` が件数 `(N)` を消してしまうため）。`updateGroupSwitcherBtn()` 自体は変更しない。

---

## 4. `js/ui-helpers.js`：`updateHandoverBadge()` にガードを追加

`async function updateHandoverBadge() {`（L169）の `try {` **直後**に追加する。

```js
    // [第13章] event では引き継ぎ未確認バッジを表示しない
    if (currentGroup?.industry === 'event') {
      const bar = document.getElementById('handover-badge-bar');
      if (bar) bar.style.display = 'none';
      return;
    }
```

以降の既存処理（サイネージ判定・1人グループ対応・第86回判定分）は**1文字も変更しない**。

---

## 5. キャッシュクエリ（★1行のみ）

`index.html` のスクリプト読み込み（L912-913）：

```html
<!-- 変更前 -->
<script src="js/ui-helpers.js?v=20260727-1"></script>
<!-- 変更後 -->
<script src="js/ui-helpers.js?v=20260728-1"></script>
```

**`js/i18n.js?v=20260727-1` は変更しないため据え置くこと。**（本Issueで i18n.js に差分は無い）

---

## 6. 動作確認項目

### A. 通常グループの回帰（★必ず最初に・「フロント」または「江の島フットボールクラブ」。「社員⭐︎」では絶対に実施しない）

| # | 確認内容 | 期待 |
|---|---|---|
| 1 | 連絡／引き継ぎ／すべて の3タブ表示 | 変化なし |
| 2 | 引き継ぎタブの一覧・「新しい引き継ぎ」作成 | 変化なし |
| 3 | 引き継ぎ未確認バッジ | 変化なし |
| 4 | 引き継ぎ画面でリロード → 画面・タブが復元される | 変化なし |
| 5 | EN → JA 切替で切替ボタンが「他のグループに切替 (N)」に戻る | **戻る**（★B修正） |

### B. event グループ（テストイベントA を使用可）

| # | 立場 | 確認内容 | 期待 |
|---|---|---|---|
| 1 | 主催者・一般参加者の両方 | タブ表示 | **「連絡」のみ**（引き継ぎ・すべてが出ない） |
| 2 | 両方 | 引き継ぎ未確認バッジ | **出ない** |
| 3 | 両方 | （タブが出ていた間に）引き継ぎ画面を開いた状態でリロード | **home（連絡一覧）に戻る**。引き継ぎ画面は復元されない |
| 4 | 両方 | event → 通常グループへまたぎ切替 | **タブが3つに戻る** |
| 5 | 両方 | EN → JA 切替 | 切替ボタンの文言が日本語に戻る |

---

## 7. 参考：実コードで確認済みの事実（2026/7/27・マージ後 main）

| # | 事実 |
|---|---|
| 1 | タブは `filter-chip-msg` / `filter-chip-handover` / `filter-chip-all`（L436-438）。制御は `setHomeFilter()`（L2329）と変数 `homeFilter`（L1312） |
| 2 | 引き継ぎ一覧への侵入経路は3つ：タブ（L437-438）・未確認バッジ `handover-badge-bar`（L427）・「すべて見る」リンク（L2591・`all` フィルター時のみ描画） |
| 3 | 画面復元は `restoreLastMajorScreen()`（L4324）。第127回で `screen-handover` とタブ状態が復元対象になっている |
| 4 | `updateHandoverBadge()` は `js/ui-helpers.js` L169 にある（index.html ではない） |
| 5 | `#group-switch-btn`（L741）は `data-i18n` 無し。文言描画は `updateGroupSwitcherBtn()`（L4077）のみ |
| 6 | `btn_switch_group` は i18n.js の ja（L170）/ en（L388）とも既存。キー追加は不要 |
| 7 | `setLang()`（L936）は applyLang → updateLangButtons → renderMessages の順に呼ぶ。切替ボタンの再描画は呼んでいない（＝Bの原因） |
