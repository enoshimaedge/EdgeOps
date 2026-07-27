# EdgeOps 実装指示書 Issue⑰
## 表示系5点:E8保険ガード／テンプレチップ非表示／期限バナー文言／画像エラー文言／写真ボタン非表示

**版**:v1.0 / **作成**:2026/7/27
**根拠**:第160回判定 論点D 一括GO(EO-DEC-0160)・仕様書v1.7 第10章/第12章
**前提**:Issue⑭・⑲ マージ済み。E6(upload-image)デプロイ済み

> **行番号は 2026/7/27 マージ後 main の実測値。行番号ではなく関数名・要素IDで対象を特定すること。**

---

## 0. 絶対条件(第160回の条件そのまま)

- **DB変更なし・集計ロジック不変更・表示制御のみ**
- **通常グループ(`industry !== 'event'`)の挙動を一切変更しない**
- `item_receivers` / `read_receipts` / `receiver_count` / `message_responses` への書込み・集計変更に触れない
- `js/i18n.js` は変更しない(本Issueで文言キーの追加は無い)
- **image.js を変更するため、scriptタグのキャッシュクエリ更新が必須**(第160回で明示条件)

## 1. 変更対象ファイル(この4つ以外を変更しないこと)

| # | ファイル | 変更内容 |
|---|---|---|
| 1 | `index.html` | 項目2(テンプレチップ)＋キャッシュクエリ3行 |
| 2 | `js/ui-helpers.js` | 項目3(バナー文言)・項目5(写真ボタン) |
| 3 | `js/survey.js` | 項目1(E8保険ガード) |
| 4 | `js/image.js` | 項目4(エラー文言) |

**変更禁止**:`js/i18n.js`、`js/auth.js`、`js/templates.js`、`js/report.js`、`styles.css`、`signage.html`、`admin.html`、`supabase/functions/` 配下すべて

## 2. 実装内容

### 項目1:E8 — アンケート集計の直接呼び出しに保険ガード(js/survey.js)

**実コードで確認済みの現状**:集計内訳(回答者・未回答者一覧)の入口ボタンは `profile-admin-section`(管理者メニュー・isCreator のみ表示)内にあり、既に管理者限定。一覧カードの進捗バッジ「回答 X/Y」は全員に表示され、第12章の「進捗は一般参加者にも表示」を満たしている。よって残作業は**万一関数を直接呼ばれた場合の保険**のみ(E5の approveMember ガードと同じ思想)。

`showSurveyList()` と `showSurveyDetail(messageId)` の**それぞれ冒頭**に追加:

```js
  // [第12章 E8 / EO-DEC-0160] event の一般参加者には集計内訳を見せない(保険ガード)
  if (typeof isEventGeneralMember === 'function' && isEventGeneralMember()) return;
```

回答UI(`applySurveyDetailUI` / `submitSurveyResponse` / `submitSurveyNotApplicable`)は**変更しない**(一般参加者も回答できる仕様)。

### 項目2:テンプレチップを event 一般参加者に非表示(index.html)

`renderMessages` 系の表示制御(現行 L2866):

```js
// 変更前
document.getElementById('template-section').style.display = (!isMsgActive || !_groupTemplatesCache || _groupTemplatesCache.length === 0) ? 'none' : '';
// 変更後
// [EO-DEC-0160] event の一般参加者には主催者向け文例チップを出さない
document.getElementById('template-section').style.display = (!isMsgActive || !_groupTemplatesCache || _groupTemplatesCache.length === 0 || (typeof isEventGeneralMember === 'function' && isEventGeneralMember())) ? 'none' : '';
```

プロフィールのテンプレ**編集**セクションは既に管理者限定(templates.js)のため触らない。

### 項目3:期限警告バナー文言(js/ui-helpers.js)

`updateExpiryWarningBar()`(L110)内、`daysLeft > 0` 側の文言のみ:

```js
// 変更前
    bar.textContent = `あと${daysLeft}日でこのグループは使用できなくなります`;
// 変更後
    // [EO-DEC-0160] event は威圧的でない文言にする(通常グループとサイネージは現行のまま)
    bar.textContent = (currentGroup?.industry === 'event')
      ? `あと${daysLeft}日でこのグループは終了します`
      : `あと${daysLeft}日でこのグループは使用できなくなります`;
```

`daysLeft <= 0` 側の文言と表示条件(SL-判定・30日閾値・warning/danger クラス)は**変更しない**。signage.html は業種判定不可のため対象外(変更しない)。

### 項目4:画像投稿エラーの文言表示(js/image.js)

**原因(確認済み)**:エラー抽出(L402)が `errJson.error || errJson.code` のみで、upload-image の応答キー **`error_code`** を読んでいない。そのため PERMISSION_DENIED(403)が `HTTP_403` 扱いになり汎用文言になる。

4-1. 抽出部(L395-410 のブロック)を修正:

```js
// 変更前
            errorCode = errJson.error || errJson.code || `HTTP_${res.status}`;
// 変更後
            errorCode = errJson.error_code || errJson.error || errJson.code || `HTTP_${res.status}`;
```

さらに同ブロックで、throw する Error にサーバーの message を持たせる:

```js
// 変更前
      throw new Error(errorCode);
// 変更後
      const err = new Error(errorCode);
      try { err.serverMessage = JSON.parse(errBody)?.message || null; } catch (_) { err.serverMessage = null; }
      throw err;
```

(実装上は errBody のスコープに合わせ、errJson を保持している場所で `err.serverMessage = errJson?.message || null;` としてよい。二重パース不要)

4-2. catch 側のマッピング(L446-467)に PERMISSION_DENIED 分岐を追加(`FEATURE_DISABLED` の分岐の直前に):

```js
    } else if (code === 'PERMISSION_DENIED') {
      // [EO-DEC-0160] サーバーの文言をそのまま表示(例:「イベントでは写真の投稿は主催者のみ可能です」)
      msg = (e && e.serverMessage) || '投稿権限がありません';
```

既存の分岐(QUOTA_EXCEEDED 等)は**変更しない**(error_code が正しく抽出されるようになることで、これらも本来の文言で出るようになる)。

### 項目5:写真ボタンを event 一般参加者に非表示(js/ui-helpers.js)

`applyImageUploadButtonVisibility()`(L9)内、`const hideBoth = ...` の定義**直後**に追加:

```js
  // [第10章 E6 表示側 / EO-DEC-0160] event の一般参加者には写真ボタンを出さない(サーバー側拒否は実装済み)
  if (typeof isEventGeneralMember === 'function' && isEventGeneralMember()) { hideBoth(); return; }
```

feature_flags 判定・camera/library 2ボタン処理・クォータUI更新は**変更しない**。

### キャッシュクエリ(index.html・3行)

| 行 | 変更前 | 変更後 |
|---|---|---|
| L913相当 | `js/ui-helpers.js?v=20260728-1` | `js/ui-helpers.js?v=20260728-2` |
| L914相当 | `js/image.js`(クエリ無し) | `js/image.js?v=20260728-1` |
| L916相当 | `js/survey.js?v=20260704-4` | `js/survey.js?v=20260728-1` |

`js/i18n.js?v=20260727-1` と `js/templates.js?v=20260704-3` は**据え置き**(変更しないため)。

## 3. 完了条件

- 変更ファイルが上記4つちょうどであること
- 新設ガード・分岐の発火条件がすべて event(一般参加者)に限定されていること
- キャッシュクエリが上記3行ちょうど更新されていること(i18n.js・templates.js は据え置き)

## 4. 動作確認

### A. 通常グループ回帰(フロント/江の島FC・社員⭐︎禁止)

| # | 確認 | 期待 |
|---|---|---|
| 1 | 一般メンバー:作成画面にテンプレチップ・写真ボタンが出る | 変化なし |
| 2 | 管理者:アンケート集計結果(一覧・詳細) | 変化なし |
| 3 | 期限バナー(30日以内のグループがあれば) | 「使用できなくなります」のまま |
| 4 | 画像投稿の上限超過時トースト | 「本日の画像投稿上限に達しました…」が正しく出る(抽出修正の副次効果) |

### B. event(テストイベントA)

| # | 立場 | 確認 | 期待 |
|---|---|---|---|
| 1 | 一般参加者(三郎) | 作成画面のテンプレチップ | **出ない** |
| 2 | 一般参加者 | 「写真を撮る/写真を選ぶ」ボタン | **出ない** |
| 3 | 一般参加者 | (万一)画像投稿がサーバーに届いた場合のトースト | 「イベントでは写真の投稿は主催者のみ可能です」 |
| 4 | 一般参加者 | アンケートに回答 | **できる**(変化なし) |
| 5 | 主催者(二郎) | テンプレチップ・写真ボタン・集計 | すべて出る |
| 6 | 両方 | 期限バナー | 「あと〇日でこのグループは**終了します**」 |
