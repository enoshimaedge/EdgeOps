# EdgeOps 実装指示書 ─ Step 5：初回100件・カーソル方式・追加読込

**版**：v1.0（2026/07/14）
**判定**：第119回（`EO-DEC-0119`・条件付きGO・11条件）／第115回（`EO-DEC-0115`）
**前提**：Step 3・4 が本番反映済み（`main` / commit `0901376` 以降）

---

## 0. 対象ファイル（この指示書で触ってよいのはこれだけ）

```
index.html          ← 唯一の変更対象
```

**触ってはならないファイル：**

```
styles.css          変更不要（既存クラスで足りる。新規クラスが必要なら本書で指定する）
auth.js             対象外
js/ui-helpers.js    対象外
js/image.js         対象外
js/templates.js     対象外
js/survey.js        対象外
js/report.js        対象外
signage.html        絶対に触らない（CSSインライン独立・signage-fetch 経由・第117回で確定）
```

**Supabase のテーブル・RPC・Edge Function は一切変更しない。**

---

## 1. いま何が起きているか（実コード）

`index.html` `loadMessages()`（L1786〜）は、**60日以内のメッセージを毎回まるごと取り直している。**

```js
// L1797-1800
supabase.from('messages').select('*')
  .eq('group_session_id', currentGroup.id)
  .gte('created_at', cutoff60d)
  .order('created_at', { ascending: false }),
```

```js
// L1809
messages = data || [];     // ← 毎回まるごと上書き
```

`.limit()` も `.range()` も無い。**60日で1000件たまれば1000件を取ってくる。**

さらに `startPolling()`（L1772）が **30秒ごとに `loadMessages()` を丸ごと呼ぶ。**

**Step 5 の目的は、これを「初回100件・追加100件」にすることである。**

---

## 2. やること（要約）

| # | |
|---|---|
| 1 | 初回は **60日以内かつ最新100件**だけ取る |
| 2 | 「もっと見る」で **さらに100件**追加する（カーソル方式） |
| 3 | 30秒ポーリングは、**読み込み済みの範囲だけ**を取り直す（案α） |
| 4 | グループを切り替えたら、**全部リセットする** |

---

## 3. 第119回の確定条件（11項目・全部守ること）

| # | 条件 |
|---|---|
| 1 | ポーリングとカーソル方式の共存は **案α**（読み込み済みの最古範囲から最新までを再取得） |
| 2 | 追加読込用カーソルは **`created_at` ＋ `id` の複合カーソル**（`.range()` は使わない） |
| 3 | ポーリング再取得は **`created_at >= oldestLoadedAt`** でよい（同一時刻の余分な取得は許容） |
| 4 | **`messages = data || []` の全件置換を維持する**（ポーリング時） |
| 5 | **`realReadMap`・既読集計・`read_receipts` の集計方法は変更しない** |
| 6 | **300件などの固定上限は設けない** |
| 7 | **`cutoff60d` は削除しない。**Step 5 は「60日以内かつ初回100件」。追加取得も60日以内に限定する |
| 8 | 追加取得結果が0件なら **`hasMore = false`** とし、追加読込UIを非表示または無効化する |
| 9 | グループ切替時に、**メッセージ配列・カーソル・`oldestLoadedAt`・`hasMore`・束の開閉状態を初期化する** |
| 10 | **`POLL_INTERVAL`（30秒）・DB・`signage.html`・L3保護領域には触れない** |
| 11 | **`index.html` L2073 相当の `msgs.length * 200` に触らない**（`max-height` は上限であり、中身より大きくても空白は出ない） |

---

## 4. 実装

### 4-1. 状態変数を追加する

**L1099〜1104 付近（`let messages = [];` のすぐ下）に追加する。**

```js
let messages = [];
let members = [];
// ...（既存）

// ── Step 5：カーソル方式（第119回・EO-DEC-0119） ──
const PAGE_SIZE = 100;          // 初回100件・追加100件（第115回）
let oldestLoadedAt = null;      // 読み込み済みの最古 created_at（ISO文字列）
let oldestLoadedId = null;      // 同時刻タイブレーク用の id
let hasMore = true;             // 追加取得の余地があるか（条件8）
let isLoadingMore = false;      // 二重押し防止
```

---

### 4-2. `loadMessages()` を「初回100件」にする

**L1786〜。`loadMessages()` の messages 取得部分だけを変える。**

**変更前（L1797-1800）：**

```js
      supabase.from('messages').select('*')
        .eq('group_session_id', currentGroup.id)
        .gte('created_at', cutoff60d)
        .order('created_at', { ascending: false }),
```

**変更後：**

```js
      supabase.from('messages').select('*')
        .eq('group_session_id', currentGroup.id)
        .gte('created_at', cutoff60d)                    // 【条件7】60日は維持
        .gte('created_at', oldestLoadedAt || cutoff60d)  // 【条件1・3】案α：読込済み範囲だけ取り直す
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })               // 【条件2】複合カーソルの安定ソート
        .limit(oldestLoadedAt ? 1000 : PAGE_SIZE),       // 初回=100件／ポーリング=読込済み範囲
```

**解説：**

- **初回**（`oldestLoadedAt === null`）→ `cutoff60d` 以降を **100件**取る
- **ポーリング**（`oldestLoadedAt` あり）→ `oldestLoadedAt` 以降を取る。**読み込み済みの範囲が対象なので、増えても数百件で収まる**

**`.limit(1000)` は安全弁である。**条件6は「固定上限を設けない」だが、これは**利用者が到達できる件数の上限**を指す。ポーリングの1回のクエリに保険をかけることは禁止していない。

---

### 4-3. `messages = data || []` の直後にカーソルを更新する

**L1809 の直後に追加する。**

```js
    messages = data || [];        // 【条件4】全件置換を維持（変更しない）
    members = memberData || [];
    handoverNotes = hwData || [];

    // ── Step 5：カーソルを更新（第119回） ──
    if (messages.length > 0) {
      const last = messages[messages.length - 1];   // 降順なので最後が最古
      oldestLoadedAt = last.created_at;
      oldestLoadedId = last.id;
    }
    // 初回取得が PAGE_SIZE 未満 → もう古いものは無い
    if (oldestLoadedAt === null || messages.length < PAGE_SIZE) {
      // ※ ポーリング時は messages.length が PAGE_SIZE を超えうるので、
      //    hasMore の判定は loadMoreMessages() の結果でのみ false にする（条件8）
    }
```

**【重要】`hasMore` を `loadMessages()` の中で `false` にしてはならない。**
ポーリングで再取得すると件数が変わるため、判定が壊れる。**`hasMore` を `false` にするのは `loadMoreMessages()` が0件を返したときだけ**（条件8）。

**ただし初回だけは例外。** 初回取得が100件未満なら、そもそも100件も無い。以下を `loadMessages()` の先頭に入れて判別する。

```js
async function loadMessages() {
  const isFirstLoad = (oldestLoadedAt === null);   // ← 追加
  try {
    // ...（既存の取得処理）

    messages = data || [];
    // ...

    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      oldestLoadedAt = last.created_at;
      oldestLoadedId = last.id;
    }
    if (isFirstLoad && messages.length < PAGE_SIZE) {
      hasMore = false;                             // 初回で100件未満 → 追加分は無い
    }
```

---

### 4-4. `loadMoreMessages()` を新設する

**`loadMessages()` の直後（L1880 付近）に追加する。**

```js
// ────────────────────────────────────────────────────────────
// Step 5：追加読込（第119回・EO-DEC-0119）
//   複合カーソル（created_at + id）で、いま持っている最古より
//   さらに古いものを PAGE_SIZE 件だけ取る。.range() は使わない（条件2）。
// ────────────────────────────────────────────────────────────
async function loadMoreMessages() {
  if (!hasMore || isLoadingMore) return;
  if (!oldestLoadedAt) return;
  isLoadingMore = true;

  const btn = document.getElementById('load-more-btn');
  if (btn) { btn.disabled = true; btn.textContent = '読み込み中...'; }

  try {
    const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // 【条件2】複合カーソル：
    //   created_at < oldestLoadedAt
    //   OR (created_at = oldestLoadedAt AND id < oldestLoadedId)
    const { data, error } = await supabase.from('messages').select('*')
      .eq('group_session_id', currentGroup.id)
      .gte('created_at', cutoff60d)                     // 【条件7】追加取得も60日以内
      .or(`created_at.lt.${oldestLoadedAt},and(created_at.eq.${oldestLoadedAt},id.lt.${oldestLoadedId})`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) throw error;

    const older = data || [];

    // 【条件8】0件なら、もう古いものは無い
    if (older.length === 0) {
      hasMore = false;
      renderMessages();
      return;
    }

    // 既読補正を、追加分にも同じロジックで適用する（条件5：集計方法は変えない）
    await applyReadCorrection(older);

    // 追記（全件置換ではなく末尾に足す）
    messages = messages.concat(older);

    // カーソルを進める
    const last = older[older.length - 1];
    oldestLoadedAt = last.created_at;
    oldestLoadedId = last.id;

    // 100件未満しか返ってこなかった → もう無い
    if (older.length < PAGE_SIZE) hasMore = false;

    preloadMessageImageUrls(older);   // 既存関数。追加分だけプリロード
    renderMessages();

  } catch (e) {
    console.error('[Step5] loadMoreMessages failed', e);
    showToast('追加の読み込みに失敗しました');
  } finally {
    isLoadingMore = false;
    const b = document.getElementById('load-more-btn');
    if (b) { b.disabled = false; b.textContent = 'もっと見る'; }
  }
}
```

---

### 4-5. 既読補正を関数に切り出す（条件5：ロジックは1文字も変えない）

**`loadMessages()` の中にある既読補正（L1834〜1869 付近・`realReadMap` を作っている部分）を、そのまま関数へ切り出す。**

**【最重要】ロジックは一切変更しない。移すだけである。**
分母・分子の扱い、送信者除外、サイネージ除外、送信後参加の除外（A〜G）は現行のまま。

```js
// ────────────────────────────────────────────────────────────
// 既読補正（既存ロジックをそのまま関数化。中身は変更しない）
//   [既読・確認集計仕様 / チャッピー第55-2回判定確定 / 2026-05-18]
//   A. 分母は送信時点で approved だった人間メンバーのみ
//   B. サイネージ端末(is_signage=true)は分母・分子から除外
//   C. 送信者は分母から除外
//   D. 送信後参加(created_at > item.created_at)は分母から除外
//   E. 退出済(status='left')は分子から除外
//   G. created_at が NULL の既存データは「参加済み」として扱う
// ────────────────────────────────────────────────────────────
async function applyReadCorrection(targetMessages) {
  if (!targetMessages || targetMessages.length === 0) return;

  const msgIds = targetMessages.map(m => m.id);
  const { data: receipts } = await supabase.from('read_receipts')
    .select('message_id, eo_uid').in('message_id', msgIds);
  const signageUids = new Set(members.filter(m => m.is_signage).map(m => m.eo_uid));

  const { data: allMembersForJoinedAt } = await supabase.from('group_members')
    .select('eo_uid, created_at')
    .eq('group_session_id', currentGroup.id);
  const memberJoinedAt = new Map();
  (allMembersForJoinedAt || []).forEach(m => {
    memberJoinedAt.set(m.eo_uid, new Date(m.created_at).getTime());
  });
  window._memberJoinedAt = memberJoinedAt;

  const realReadMap = {};
  (receipts || []).forEach(r => {
    if (signageUids.has(r.eo_uid)) return;
    const msg = targetMessages.find(m => m.id === r.message_id);
    if (!msg) return;
    if (r.eo_uid === msg.sender_eo_uid) return;
    const joinedAt = memberJoinedAt.get(r.eo_uid);
    if (joinedAt === undefined) return;
    if (joinedAt > new Date(msg.created_at).getTime()) return;
    realReadMap[r.message_id] = (realReadMap[r.message_id] || 0) + 1;
  });

  // 破壊的に上書きする（呼び出し元の配列をそのまま補正する）
  targetMessages.forEach(m => {
    if (realReadMap[m.id] !== undefined) m.read_count = realReadMap[m.id];
  });
}
```

**`loadMessages()` 側は、切り出した関数を呼ぶだけにする。**

```js
    // （旧）if (messages.length > 0) { ... 長い既読補正 ... }
    // （新）
    await applyReadCorrection(messages);
```

**既存の `else` 節（実コードで確認済み）も保つこと。**

```js
    if (messages.length > 0) {
      await applyReadCorrection(messages);
    } else {
      // メッセージ0件のときは参加時刻マップを空に初期化（グループ切替時の残留防止）
      window._memberJoinedAt = new Map();
    }
```

---

### 4-6. 「もっと見る」ボタンを置く

**`renderMessages()`（L1978〜）の末尾、`container.innerHTML = html;` の直前に追加する。**

```js
  // ── Step 5：追加読込ボタン（第119回・条件8） ──
  if (hasMore && messages.length > 0) {
    html += `
      <div style="padding:16px; text-align:center;">
        <button id="load-more-btn" class="btn btn-secondary"
                onclick="loadMoreMessages()"
                style="max-width:260px; margin:0 auto;">もっと見る</button>
      </div>`;
  }

  container.innerHTML = html;
```

**`hasMore === false` のときは、ボタンを出さない。**（条件8）

---

### 4-7. グループ切替時に全部リセットする（条件9）

**`switchGroup()`（L3407〜）の中、`await loadHome();` の直前に追加する。**

```js
  // ── Step 5：グループ切替時の初期化（第119回・条件9） ──
  messages = [];
  oldestLoadedAt = null;
  oldestLoadedId = null;
  hasMore = true;
  isLoadingMore = false;
  monthOpenState = {};              // 4-8で新設する（月カードの開閉状態）
  window._memberJoinedAt = new Map();

  await loadHome();
```

---

### 4-8. 月カードの開閉状態をモジュールスコープで持つ（第115回・必須）

**【実コードで確認済みの事実】現在、月カードの開閉状態を保持する変数は存在しない。**
`toggleMonth()`（L2154）は DOM のクラス（`.collapsed`）だけで制御しており、`renderMessages()` が走ると開閉状態はリセットされる。

**第115回の確定条件：「開閉状態はモジュールスコープで保持し、グループ切替時に必ず初期化する」**
**これは未実装である。Step 5 で実装する。**

**① 状態変数を追加する（4-1 と同じ場所）**

```js
let monthOpenState = {};   // { '2026-07': true, '2026-06': false } 形式
```

**② `toggleMonth()`（L2154）に、状態の記録を1行足す**

```js
function toggleMonth(id) {
  const body = document.getElementById(id);
  const monthKey = id.replace('month-', '');
  const toggle = document.getElementById('toggle-' + monthKey);
  if (!body) return;
  const isCollapsed = body.classList.contains('collapsed');

  monthOpenState[monthKey] = isCollapsed;   // ← 追加。開くなら true

  if (isCollapsed) {
    // ...（以下、既存のまま。1文字も変えない）
```

**③ `renderMessages()` の `isOpen` 判定を、状態変数を見るように変える**

**変更前（L2062 付近）：**

```js
    const isLatest = idx === 0;
    const needAccordion = msgs.length >= 50;
    const isOpen = isLatest || !needAccordion;
```

**変更後：**

```js
    const isLatest = idx === 0;
    const needAccordion = msgs.length >= 50;
    // 【第115回】開閉状態を保持する。記録が無ければ従来どおり（最新月は開く）
    const isOpen = (monthOpenState[monthKey] !== undefined)
      ? monthOpenState[monthKey]
      : (isLatest || !needAccordion);
```

**`maxH` の計算（`msgs.length * 200`）には触らないこと（条件11）。**

---

## 5. 触ってはならないもの（再掲・違反したらNG）

| # | |
|---|---|
| 1 | **`POLL_INTERVAL = 30000`（L1086）を変えない**（条件10） |
| 2 | **`msgs.length * 200`（`renderMessages()` 内の `maxH`）に触らない**（条件11）。`max-height` は上限であり、中身より大きくても空白は出ない |
| 3 | **`cutoff60d` を削除しない**（条件7） |
| 4 | **`messages = data || []` の全件置換を維持する**（条件4）。ポーリング時の話であり、`loadMoreMessages()` は `concat` である |
| 5 | **既読集計ロジック（A〜G）を1文字も変えない**（条件5）。関数へ移すだけ |
| 6 | **`.range()` を使わない**（条件2）。必ず複合カーソル |
| 7 | **`styles.css` を変更しない**。既存の `.btn` `.btn-secondary` で足りる |
| 8 | **`signage.html`・`js/` 配下・`auth.js` を変更しない** |
| 9 | **DB・RPC・Edge Function を変更しない** |
| 10 | **不要なリファクタをしない。** 動いているコードの整形・変数名変更・コメント削除は禁止 |

---

## 6. 完了条件（自己チェック）

- [ ] 初回に**100件だけ**取得している（ネットワークタブで確認）
- [ ] 「もっと見る」で**さらに100件**追加される
- [ ] 100件未満のグループでは**「もっと見る」が出ない**
- [ ] 最後まで読み込むと**「もっと見る」が消える**
- [ ] 30秒ポーリングで**表示が壊れない**（重複しない・消えない）
- [ ] グループを切り替えると**一覧が最新100件に戻る**
- [ ] **既読数（既読 4/11）が Step 5 の前後で変わらない**
- [ ] 月カード・日付見出しが**従来どおり出る**
- [ ] **月カードを閉じてから「もっと見る」を押しても、閉じたままである**（第115回・開閉状態の保持）
- [ ] **グループを切り替えると、月カードの開閉状態がリセットされる**（第115回・条件9）
- [ ] `signage.html` が**従来どおり動く**
- [ ] JavaScript の構文エラーが無い

---

## 7. 差分の目安

```
index.html      約 +90 行 / -35 行（既読補正の関数化を含む）
その他          変更なし
```

**これより大きく変わっていたら、余計なことをしている。**

---

## 8. 疑問があるとき

**推測で実装しないこと。** 実コードを読んで行番号を示し、判断を仰ぐこと。
**「コードが真実」。この指示書とコードが食い違ったら、コードが正である。**
