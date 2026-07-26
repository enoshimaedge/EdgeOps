# EdgeOps 実装指示書 Issue⑭（PR2）
## E5 承認権限 ／ E7 既読・未読の非表示 ／ 参加人数表示

**版**：v1.3 ／ **作成**：2026/7/26 ／ **改訂**：2026/7/26
**根拠判定**：第154回（EO-DEC-0154）＋ 第157回（EO-DEC-0157）＋ **第158回 論点D（EO-DEC-0158・条件付きGO）**
**正本**：**`EdgeOps_ST版イベント催事モード仕様書_v1_7.docx`**（第11-2章・第21-6章・第22章・第23章・第24章）
**前提**：Issue⑬（E1・E2・E4・E10）＋ `form_group_name_event` 修正がマージ済み・本番稼働中であること

> **行番号について**：本書の行番号は **2026/7/26 反映後**の `index.html`（4,473行）に基づく実測値。
> ただし編集で前後するため、**行番号ではなく関数名・要素IDで対象を特定すること。**

### 改訂記録

| 版 | 内容 |
|---|---|
| v1.0 | 初版（E5・E7・参加人数） |
| **v1.1** | **第157回判定（A＝案ア／B＝案ア／C＝案ア）を反映。** 3-4章（作成ボタン）・3-5章（参加ボタン）・4-5章（引き継ぎ詳細）・5-2章（日付欄）を新設。旧8章の確認事項3点は判定済みのため確定事項へ移動 |
| **v1.3** | **総なめ確認の指摘5点を反映。** ①`js/ui-helpers.js` を変更するため**同ファイルのキャッシュクエリも更新**する（v1.2は「変更しない」と誤記）②確認項目の「/200人」固定表現を動的表現へ修正 ③3-5-1の「4つ追加」を「3キー追加」へ修正 ④章番号の重複（5-2）を 5-5 へ変更 ⑤正本を v1.7 に更新 |
| **v1.2** | **第158回 論点D を反映。** 5章の参加人数の分母を「`max_members` − 2」の固定計算から、**実際のサイネージ台数を数える動的計算**へ変更。**第158回のA・B・C・Eは8/7以降のため本PRには含めない** |

---

## 0. 絶対条件（最優先・第0章）

> ### 通常グループ（`industry !== 'event'`）の既存挙動を、一切変更しないこと。

本PRの変更は **すべて `currentGroup.industry === 'event'` の分岐配下**に置く。
`industry` の判定を通さずに既存の表示・集計・クエリを書き換えてはならない。

**特に触れてはならないもの（第118回 条件12 を継承）**

- 既読集計ロジック／`realReadMap`／`read_receipts`／`receiver_count`／`item_receivers`
- `messages` テーブルへの読み書き
- `signage.html` および `signage-fetch` Edge Function
- L3保護領域（`group_sessions` / `group_members` / `messages`）のスキーマ

---

## 1. 変更対象ファイル（この3つ以外を変更しないこと）

| # | ファイル | 変更内容 |
|---|---|---|
| 1 | `index.html` | ヘルパー追加・E5・E7・**`i18n.js` と `ui-helpers.js` のキャッシュクエリ更新（2行とも）** |
| 2 | `js/ui-helpers.js` | `updateMemberCount()` の分岐追加 |
| 3 | `js/i18n.js` | 文言キー追加（ja / en 両方） |

**変更してはならないファイル**：`signage.html`、`js/auth.js`、`js/image.js`、`js/templates.js`、`js/survey.js`、`js/report.js`、`styles.css`、`admin.html`、`supabase/functions/` 配下すべて

> **★注意**：Step 3・4 で `js/` 配下5ファイルの見落としが発生した。
> 本PRでは **`js/ui-helpers.js` に必ず変更が入る**。差分が `index.html` だけで終わっていたら誤りである。

---

## 2. 共通ヘルパーの追加（`index.html`）

E5・E7 が同じ判定を使うため、先にヘルパーを1つ追加する。
`isCreator`（グローバル）と `currentGroup` を参照する位置、すなわち **`showProfile()` の定義より前**に置くこと。

```js
// ── イベント催事モード判定（仕様書 第22章・第154回 EO-DEC-0154） ──
// event グループかどうか
function isEventGroup() {
  return currentGroup?.industry === 'event';
}
// event グループの「一般参加者」（主催者＝作成者ではない人）かどうか
// ※ST版は案A（フロント表示制御のみ）。サーバー側の権限制御は行わない。
function isEventGeneralMember() {
  return isEventGroup() && !isCreator;
}
```

**通常グループでは `isEventGroup()` が常に `false` を返すため、以降の分岐はすべて素通りする。**

---

## 3. E5 承認権限（案A・フロント表示制御のみ）

**目的**：event グループでは、参加申請の承認・却下を主催者だけが行えるようにする。

### 3-1. ヘッダーの承認アイコンを隠す

対象：`index.html` の `id="approval-btn"`（現行 L402 付近・`showScreen('screen-approval')` を呼ぶ要素）

この要素の表示を制御している既存処理（承認待ち件数のバッジ更新箇所）に、次の分岐を**追加**する。
既存の表示条件は残したまま、**event かつ一般参加者のときだけ強制的に隠す**こと。

```js
if (isEventGeneralMember()) {
  approvalBtn.style.display = 'none';
}
```

### 3-2. 承認・却下ボタンを描画しない

対象：`loadApprovals()` 内の `container.innerHTML = pending.map(...)` の箇所

`isEventGeneralMember()` が `true` のとき、**そもそも承認待ち一覧を描画せず**、次の案内だけを表示する。

```js
if (isEventGeneralMember()) {
  container.innerHTML =
    `<div class="empty" style="padding:40px;"><div class="empty-text">${t('empty_approval_organizer_only')}</div></div>`;
  return;
}
```

**`pending` を取得するクエリ自体は変更しない**（通常グループと共通のため）。

### 3-3. `approveMember()` の冒頭にガードを置く

対象：`async function approveMember(memberId, displayName) {` の直後（現行 L3374 付近）

```js
async function approveMember(memberId, displayName) {
  // [第154回 EO-DEC-0154・案A] event では主催者以外の承認を受け付けない
  if (isEventGeneralMember()) {
    showToast(t('toast_approval_organizer_only'));
    return;
  }
  try {
    ...
```

**`try` ブロックの中ではなく、関数の先頭に置くこと。**

### 3-4. `rejectMember()` にもガードを置く ★第157回 論点B

対象：`async function rejectMember(memberId, displayName) {`（**L3505**）の直後

**第157回で「event の承認権限は承認・却下の両方を含む」と確定した。**

```js
async function rejectMember(memberId, displayName) {
  // [第157回 EO-DEC-0157・論点B] event では主催者以外の却下も受け付けない
  if (isEventGeneralMember()) {
    showToast(t('toast_approval_organizer_only'));
    return;
  }
  if (!confirm(`${displayName}さんの参加申請を却下しますか?\n本人には通知されません。`)) return;
  try {
    ...
```

**`confirm()` より前**に置くこと。トーストのキーは 3-3章と同じものを使い回す。

> **仕様書 v1.6 への記録事項（第157回の条件）**：
> 本ガードは**フロント側の暫定制御**であり、`group_members` の完全なサーバー側権限制御ではない。

---

### 3-5. 【第157回 論点A】作成ボタンと参加ボタンの文言差し替え

#### 3-5-1. `js/i18n.js` にキーを3つ追加（本節ぶん）

`ja` と `en` の**両方**の末尾（`form_group_name_event` の直後）に追加する。**本節で追加するのは3キー。** 6章の承認系2キーと合わせて**本PR全体で5キー**になる。

**ja に追加**

```js
    btn_create_group:            '新しいグループを作る',
    btn_create_group_event:      '新しいイベントを作る',
    btn_join_event:              'イベントに参加する',
```

**en に追加**

```js
    btn_create_group:            'Create Group',
    btn_create_group_event:      'Create Event',
    btn_join_event:              'Join Event',
```

**`btn_join` は既存キーのため追加しない。値も変更しない。**

#### 3-5-2. 作成ボタンに `data-i18n` を付与する

`index.html` **L292-294**。現在この要素には `data-i18n` が無く、英語モードでも日本語のままである（翻訳漏れ）。

```html
<!-- 変更前 -->
        <button class="btn btn-primary" onclick="createGroup()">
           新しいグループを作る
        </button>
<!-- 変更後 -->
        <button class="btn btn-primary" onclick="createGroup()">
          <span data-i18n="btn_create_group">新しいグループを作る</span>
        </button>
```

**`<span>` で包むこと。** ボタン直下のテキストノードを `applyLang()` が書き換えられないため。

> **第157回の判断**：英語モードで日本語が残る現状は**翻訳漏れであり不具合**である。
> この修正は通常グループの機能変更ではなく、**不具合修正として扱う**。
> **`textContent` を直接書き換える方式は不採用**（第154回で否決済み）。

#### 3-5-3. `EVENT_I18N_PAIRS` に2組追加

`index.html` **L989-997**。`['form_group_name', 'form_group_name_event'],` の**次の行**に追加する。

```js
  ['btn_create_group',       'btn_create_group_event'],
  ['btn_join',               'btn_join_event'],
```

**既存の7組は順序も含めて変更しないこと。**

#### 3-5-4. キャッシュ番号を上げる ★必須・v1.3で修正

`index.html` **L911-912**。**本PRでは `js/i18n.js` と `js/ui-helpers.js` の両方を変更するため、2行とも上げること。**

```html
<!-- 変更前 -->
<script src="js/i18n.js?v=20260726-1"></script>
<script src="js/ui-helpers.js?v=20260724-1"></script>
<!-- 変更後 -->
<script src="js/i18n.js?v=20260727-1"></script>
<script src="js/ui-helpers.js?v=20260727-1"></script>
```

> **★v1.2 の誤りを訂正**：v1.2 では「`ui-helpers.js?v=20260724-1` は変更しないこと」と書いていたが、**本PRは 5章で `js/ui-helpers.js` の `updateMemberCount()` を変更する。** キャッシュ番号を据え置くと、端末が古い `ui-helpers.js` を読み続け、**参加人数の動的計算が反映されない。** 必ず両方上げること。

---

## 4. E7 既読・未読の非表示（案サ）

**目的**：event グループの一般参加者には、既読数も未読者一覧も一切見せない。

> 誰が読んだかを参加者同士が見られる状態は、催事の一般参加者にとって不要かつ不適切であるため。

### 4-1. 連絡一覧の既読表示

対象：`index.html` の `function eoReadHtmlOf(msg)`（現行 L2368）

**関数の冒頭で空文字を返す**。これ1箇所で、この関数を呼ぶすべての表示（現行 L2403・L2433）が同時に消える。

```js
function eoReadHtmlOf(msg) {
  if (isEventGeneralMember()) return '';   // [E7・案サ]
  const receiverCount = eoReceiverCountOf(msg);
  ...
```

### 4-2. 連絡一覧（通常行）の既読表示

対象：`function renderMessages()` 内で `readHtml` を組み立てている箇所（現行 L2584-2588）

`readHtml` の代入直後に、次の1行を**追加**する。

```js
const readHtml = isDone ? ... : ...;
if (isEventGeneralMember()) readHtml = '';   // [E7・案サ] ※const → let に変更すること
```

> **`readHtml` は現状 `const` で宣言されている。`let` に変えること。**
> `receiverCount` の算出ロジック（L2560-2583）には**触れないこと**。分母の計算そのものは変更対象外である。

### 4-3. 詳細画面の既読／未読／合計カードと名簿

対象：`async function showDetail(messageId)`（現行 L3135）

既読・未読の描画処理が終わったあと（`detail-unread-list` への代入より後）に、次のブロックを**追加**する。
**集計処理そのものは残し、表示だけを隠すこと**（第118回 条件12 の趣旨を継承する）。

```js
// [E7・案サ] event の一般参加者には既読・未読を一切表示しない
if (isEventGeneralMember()) {
  const hideIds = ['detail-read-count', 'detail-unread-count', 'detail-total-count'];
  // 3カードの親（flex 行）ごと隠す
  const statRow = document.getElementById('detail-read-count')?.closest('div[style*="display:flex"]');
  if (statRow) statRow.style.display = 'none';
  // 既読名簿・未読名簿のカードごと隠す
  document.getElementById('detail-read-list')?.closest('.card')?.style.setProperty('display', 'none');
  document.getElementById('detail-unread-list')?.closest('.card')?.style.setProperty('display', 'none');
}
```

**★重要**：`showDetail()` は通常グループでも呼ばれる。上記ブロックは `if (isEventGeneralMember())` の中だけに置き、
**通常グループでは一度も実行されないこと**を差分で確認できるようにすること。

### 4-4. 返信スレッドの既読表示

対象：`async function renderDetailThread(msg)`（現行 L3700）

**仕様書 第21-6章により、返信側の既読表示も同じ制御に含める。**
返信一覧の各行に既読表示を出している箇所があれば、`isEventGeneralMember()` のとき出力しないこと。
（現行コードでは返信行に既読表示は無いが、元投稿の表示に `eoReadHtmlOf` が波及していないか差分で確認すること）

### 4-5. 引き継ぎ詳細の確認状況を隠す ★第157回 論点C

対象：`async function showHandoverDetail(handoverId)`（**L3030**）

**第157回で「連絡・返信・引き継ぎのすべてで、他者の確認状況を一般参加者に見せない」と確定した。**

`hw-confirmed-list` / `hw-unconfirmed-list` への代入がすべて終わったあとに、次を**追加**する。

```js
// [第157回 EO-DEC-0157・論点C] event の一般参加者には確認状況を表示しない
if (isEventGeneralMember()) {
  document.getElementById('hw-confirmed-list')?.closest('.card')?.style.setProperty('display', 'none');
  document.getElementById('hw-unconfirmed-list')?.closest('.card')?.style.setProperty('display', 'none');
}
```

**★守ること（第157回の条件）**

| # | 条件 |
|---|---|
| 1 | **`handover_confirmations` の集計ロジックには一切触れない。** 表示だけを隠す |
| 2 | **`hw-confirm-area`（自分の確認ボタン・L687）は隠さない。** 本人が確認する操作は残す |
| 3 | **管理者（`isCreator === true`）には従来どおり表示する** |
| 4 | **通常グループの表示は変更しない** |
| 5 | `validConfs` / `eligibleMembers` の算出（L3080-3100 付近）は変更しない |

---

## 5. 参加人数表示（仕様書 第11-2章＋第158回 論点D）★v1.2で計算方法を変更

**対象ファイル：`js/ui-helpers.js`（現行 L359-369 `updateMemberCount()`）**

### 5-1. 第158回 論点D による変更点

v1.1 では分母を `max_members - 2`（主催者1＋サイネージ1を固定で引く）としていた。

**第158回でサイネージの指定方式が変わり、台数が可変になるため、この固定計算は成立しない。**

| サイネージ | 実際に入れる一般参加者 | `- 2` の表示 |
|---|---|---|
| 0台 | 201人 | 200人（1人少なく出る） |
| 1台 | 200人 | 200人（正しい） |
| 2台 | 199人 | **200人（1人多く出る）** |
| 3台 | 198人 | **200人（2人多く出る）** |

**第158回の指定方式が入る8/7までの間も、サイネージ台数は0台や複数台になり得る。** よって本PRの時点で動的計算にする。

### 5-2. 実装

```js
async function updateMemberCount() {
  const membersEl = document.getElementById('profile-members');
  if (!membersEl || !currentGroup?.id) return;

  // ── [第11-2章＋第158回 論点D] イベント催事モード ──
  if (currentGroup.industry === 'event') {
    const { data } = await supabase
      .from('group_members')
      .select('is_creator, is_signage')
      .eq('group_session_id', currentGroup.id)
      .eq('status', 'approved');
    const rows = data || [];
    const creators = rows.filter(m => m.is_creator).length;
    const signages = rows.filter(m => !m.is_creator && m.is_signage).length;
    const attendees = rows.filter(m => !m.is_creator && !m.is_signage).length;
    const capacity  = Math.max(0, (currentGroup.max_members || 202) - creators - signages);
    membersEl.textContent = `参加中：${attendees} / ${capacity}人`;
    return;
  }

  // ── 通常グループ：以下は既存のまま。1文字も変更しないこと ──
  const maxMembers = currentGroup.max_members || 50;
  const { count } = await supabase
    .from('group_members')
    .select('*', { count: 'exact', head: true })
    .eq('group_session_id', currentGroup.id)
    .eq('status', 'approved');
  membersEl.textContent = `参加中：${count || 0} / ${maxMembers}人`;
}
```

### 5-3. 守ること

| # | 条件 |
|---|---|
| 1 | **`200` を直接書かない。** `max_members` から算出する |
| 2 | **主催者数もサイネージ台数も、固定値ではなく実際に数える**（主催者は通常1名だが、数えた値を使う） |
| 3 | 主催者は分子（`attendees`）から除く。サイネージも除く |
| 4 | `Math.max(0, ...)` で下限を0にする。指定台数が増えても負数にならないようにする |
| 5 | **通常グループの `head: true` カウントは1文字も変更しない** |
| 6 | 表示文字列の形（`参加中：N / M人`）は既存と同じにする |

### 5-4. ★表示ラベルについて（第158回の注意）

**「出展者200名固定」と言い切る表現にしないこと。** サイネージ台数によって分母は変動する。分母は「event の一般参加者枠」を表す数として扱う。

本PRでは既存と同じ `参加中：N / M人` の形を維持するため、この点で追加の文言変更は不要である。**仕様書やマニュアルに「200名まで」と断定して書かないこと。**

---

## 5-5. 期限入力欄の右端が見切れる不具合 ★第157回で index.html 限定修正を承認

対象：`index.html` **L218**

**`styles.css` は変更しないこと。** `.form-input`（styles.css L249-255）は `width:100%`、全体に `box-sizing:border-box`（L1）が効いており、他の入力欄は正常である。`type="date"` に固有の最小幅の問題であるため、**この1要素にインライン指定を足すだけに限定する。**

```html
<!-- 変更前 -->
          <input class="form-input" id="input-event-last-day" type="date">
<!-- 変更後 -->
          <input class="form-input" id="input-event-last-day" type="date"
                 style="min-width:0; max-width:100%;">
```

**まず `min-width:0; max-width:100%;` だけで試すこと。** これで直らない場合に限り、`-webkit-appearance:none; appearance:none;` の追加を検討する（iOS で日付表示が消える副作用があるため、安易に付けない）。

**他の `.form-input` 要素には一切手を加えないこと。**

---

## 6. `js/i18n.js` に追加するキー

`ja` と `en` の**両方**に追加すること。片方だけの追加は不可。

| キー | ja | en |
|---|---|---|
| `empty_approval_organizer_only` | 参加申請の承認は主催者が行います | Only the organizer can approve join requests |
| `toast_approval_organizer_only` | 承認できるのは主催者だけです | Only the organizer can approve members |
| `btn_create_group` | 新しいグループを作る | Create Group |
| `btn_create_group_event` | 新しいイベントを作る | Create Event |
| `btn_join_event` | イベントに参加する | Join Event |

**合計5キー。** `btn_join` は既存のため追加しない。

---

## 7. 動作確認項目

### A. 通常グループの回帰（★必ず最初に実施）

対象：**「フロント」または「江の島フットボールクラブ」**（★**「社員⭐︎」では絶対に実施しないこと**。顧客本番グループ）

| # | 確認内容 | 期待 |
|---|---|---|
| 1 | 連絡一覧に「既読 4/11」が表示される | 変化なし |
| 2 | 連絡詳細に既読／未読／合計の3カードが出る | 変化なし |
| 3 | 既読名簿・未読名簿が出る | 変化なし |
| 4 | 返信スレッドの表示 | 変化なし |
| 5 | ヘッダーの承認アイコンが出る | 変化なし |
| 6 | 承認・却下ができる | 変化なし |
| 7 | プロフィール画面の参加中人数が `N / 50人` | 変化なし（★通常グループには動的計算を適用しない） |
| 8 | グループ作成画面の見出し・グループ名ラベル | **「新しいグループを作る」「グループ名（任意）」のまま** |
| 9 | 作成ボタン・参加ボタン（**日本語モード**） | **「新しいグループを作る」「グループに参加する」のまま** |
| 10 | 作成ボタン・参加ボタン（**英語モード**） | **"Create Group" / "Join Group"**（★従来は日本語のまま＝翻訳漏れの解消。第157回で承認済み） |
| 11 | 引き継ぎ詳細の確認済み／未確認メンバー | 変化なし（表示される） |

### B. event グループ（新規作成して確認）

| # | 立場 | 確認内容 | 期待 |
|---|---|---|---|
| 1 | 主催者 | 承認アイコン・承認ボタン | **出る**（従来どおり） |
| 2 | 主催者 | 既読／未読の表示 | **出る**（従来どおり） |
| 3 | 一般参加者 | 承認アイコン | **出ない** |
| 4 | 一般参加者 | screen-approval を直接開いた場合 | 「参加申請の承認は主催者が行います」 |
| 5 | 一般参加者 | 連絡一覧の既読表示 | **出ない** |
| 6 | 一般参加者 | 連絡詳細の既読／未読／合計カード | **出ない** |
| 7 | 一般参加者 | 既読名簿・未読名簿 | **出ない** |
| 8 | 主催者 | プロフィールの参加中人数 | **主催者と「実際のサイネージ台数」を除いた分子・分母で表示される。** サイネージ1台なら `/ 200人`、2台なら `/ 199人`、0台なら `/ 201人`。**`200` 固定ではない** |
| 9 | — | 作成画面の作成ボタン | **「新しいイベントを作る」** |
| 10 | — | 参加欄のボタン | **「イベントに参加する」** |
| 11 | — | 英語モードに切替 | **"Create Event" / "Join Event"**。JA に戻すとイベント表記のまま |
| 12 | — | 「利用できる最終日」の日付欄 | **右端が見切れない**（実機で確認） |
| 13 | 一般参加者 | 引き継ぎ詳細の確認済み／未確認メンバー | **出ない** |
| 14 | 一般参加者 | 引き継ぎ詳細の自分の確認ボタン | **出る**（隠さない） |
| 15 | 主催者 | 引き継ぎ詳細の確認済み／未確認メンバー | **出る** |
| 16 | 一般参加者 | 承認・却下（直接呼び出し時） | どちらも拒否される |

---

## 8-0. 第158回で確定した事項のうち、本PRに含めるもの（EO-DEC-0158・条件付きGO）

| 論点 | 判定 | 本PRでの扱い |
|---|---|---|
| **D** 参加人数の分母を動的計算するか | **案ア（Issue⑭で動的化）** | **5章に反映。本PRに含める** |
| A 第7章の設計差し替え | 案ア | **8/7以降。本PRに含めない** |
| B event で `p_is_signage` を無視 | 案ア | **8/7以降。本PRに含めない** |
| C サイネージ指定はRPC | 案イ | **8/7以降。本PRに含めない** |
| E 承認画面に「サイネージ端末」表示 | **案ア（取り下げ）** | **実装しない**（第157回で検討していた案は消滅） |

> **★本PRでは `join_group_with_member` RPC に一切触れないこと。** 第158回のA・B・Cはすべて8/7以降の別Issueである。

---

## 8. 第157回で確定した事項（EO-DEC-0157・条件付きGO）

v1.0 で「起票前に決めること」としていた3点は、**すべて判定で確定した。**

| 論点 | 判定 | 反映先 |
|---|---|---|
| A：作成ボタンに `data-i18n` を付けるか | **案ア（付ける）** | 3-5章 |
| B：`rejectMember()` にもガードを置くか | **案ア（置く）** | 3-4章 |
| C：引き継ぎ詳細の未読表示もE7対象に含めるか | **案ア（含める）** | 4-5章 |
| 参加ボタン `btn_join` の差し替え | 報告どおりGO | 3-5章 |
| 期限入力欄の見切れ | index.html 限定修正でGO | 5-2章 |

**第157回の付帯条件（全体に適用）**

> **通常グループの日本語表示・機能・集計・権限挙動は変更しない。**
> `handover_confirmations` および既読集計ロジックには触れず、**表示制御のみ**とする。
> E5 のガードはフロント側の暫定制御であり、サーバー側の完全な権限制御ではないことを仕様書に残す。

---

## 9. 参考：実コードで確認済みの事実（2026/7/26）

| # | 事実 |
|---|---|
| 1 | `updateMemberCount()` は `index.html` に無く **`js/ui-helpers.js` L359-369** にある |
| 2 | `index.html` L3899 の `profile-members` は読み込み中の仮表示のみ。人数計算はしていない |
| 3 | 一覧の既読表示は2経路ある：`eoReadHtmlOf()`（L2368・返信スタック用）と `renderMessages()` 内の `readHtml`（L2584）。**両方を塞ぐ必要がある** |
| 4 | 詳細画面の既読／未読／合計は `detail-read-count` / `detail-unread-count` / `detail-total-count`（L573-584） |
| 5 | 名簿は `detail-read-list` / `detail-unread-list`（L588・L592）。いずれも `.card` の中にある |
| 6 | `approveMember()` は RPC を使わず `group_members` をフロントから直接 UPDATE している（案Aが暫定である理由） |
| 7 | `readHtml`（L2586）は `const` 宣言。E7 で書き換えるには `let` へ変更が必要 |
