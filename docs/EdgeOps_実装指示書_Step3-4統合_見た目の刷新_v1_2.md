# EdgeOps 実装指示書 Step 3・4（統合）：見た目の刷新

| 項目 | 内容 |
|---|---|
| 対象 | **GitHub Copilot** |
| 版 | **v1.2** |
| 作成日 | 2026/7/13（**v1.2 改訂：2026/7/14**） |
| **v1.2 の改訂点** | **チャッピー第119回の差し戻しを反映。**（1）**v1.1 で新設した 4-8「月カードの高さ計算」を撤回・削除**（`max-height` は上限であり実高さを強制しない。空白は発生しない。**v1.1 の記述は誤りだった**）（2）全員既読に緑を使わない（3）`--eo-bg` → `--eo-surface-sunken`（4）日付見出しの年またぎ対応（5）`.unread-names` は検索してから削除（6）**絵文字を機械的にSVG化しない**（7）i18n はキー共用可 |
| 根拠判定 | 第116回（`EO-DEC-0116`）／第117回（`EO-DEC-0117`）／**第118回（`EO-DEC-0118`・条件13）** |
| 正典 | **EdgeOps UIデザイン仕様書 v1.13**（実装時はこれだけを読む） |
| 前提 | **Step 1 完了**（`ds-step1` / `4fd13e8`）・**Step 2 完了**（`ds-step2`） |
| 対象ファイル | **`index.html`** ／ **`styles.css`** ／ **`js/i18n.js`（新規）** |
| **見た目の変化** | **大きく変わる**（本PRが「刷新」の本体） |

---

## 0. なぜ Step 3 と Step 4 を統合するのか

**第118回・条件13**：

> **この変更は Step 3・4 の統合実装へ反映する。種別の縦帯変更と一覧リスト化を同じ整合した状態で公開する。**

**分けると中途半端な状態が公開される。**

- Step 3 だけ入れる → 一覧がリスト化されるが、**種別はまだ絵文字バッジ**（🔴 緊急）
- Step 4 だけ入れる → 種別が縦帯になるが、**一覧はまだカード型**

**どちらも「整合していない画面」である。同時に公開する。**

---

## 1. 絶対的な制約

| # | 制約 | 根拠 |
|---|---|---|
| 1 | **DBに触れない。** `priority` の値（`urgent` / `normal` / `info`）を変更しない | 第116回⑤ |
| 2 | **既読集計ロジック・`realReadMap` に触れない** | **第118回・条件12**／第55-2回 |
| 3 | **`signage.html` に触れない** | **第118回・条件12**／第117回（CSS独立・確認済み） |
| 4 | **絵文字の一括削除（`sed` 等）を禁止する** | **コメント55行を破壊する**（下記3章） |
| 5 | **投稿本文・テンプレート文面の絵文字を削除しない** | 仕様書 第6章 |
| 6 | **`padding: 14px 16px` を縮小しない** | **第118回・条件9** |
| 7 | **既読数を赤くしない。赤は「至急」だけ** | **第118回・条件3** |
| 8 | Design System 全体のカード型は維持する。**リスト化は連絡メッセージ一覧のみ** | **第118回・条件1** |

---

## 2. 実装前の必須確認

```bash
# ① Step 1・2 が入っていること
grep -c -- '--eo-' styles.css          # 20件以上あること
grep -c 'var(--eo-' styles.css         # 1件以上あること（Step 2 で参照済み）

# ② 変更対象の実数
grep -c 'priority' index.html          # 27件前後
```

**①が満たされない場合は停止して報告すること。**

---

## 3. 【最重要】絵文字の仕分け ─ 一括削除は禁止

**実コードを解析した結果、絵文字を含む行は 252箇所ある。しかし、そのすべてが置換対象ではない。**

| 分類 | 行数 | **扱い** |
|---|---|---|
| **コメント行**（ファイル先頭の構造マップ・`★` `→` 等） | **55行** | **絶対に触らない** |
| **UI部品** | **162行** | **置換対象** |
| **テンプレート文面**（ユーザーコンテンツ） | 3行 | **要判断**（下記3-3） |

### 3-1. 触ってはならない箇所（コメント）

```
L73:  ★旧資料の行番号(L1205-1211 / L1350-1369 / L3129-3135)は
L405: - グループ管理者が profile 画面から URL 設定 → 表示
L896: <!-- ★ 案C-改: 他のグループに参加するための導線 -->
```

**これらはコードの構造マップである。`★` や `→` を削除すると、開発者が読めなくなる。**

**`<!-- -->` の内部、`//` で始まる行、`/*` `*/` の内部は、すべて対象外とする。**

### 3-2. 置換対象（UI部品・162行）

#### 【第119回・修正6】**162行すべてをSVGにしてはならない**

**確定方針：アイコンより文字を重視し、本当に必要なSVGだけを使う。**

**機械的にSVG化すると、不要なアイコンを大量に生成し、「装飾過多」というブランド原則（静かなラグジュアリー）に反する。**

**対応は次の3種類に分ける。1行ずつ判断すること。**

| 対象 | 対応 |
|---|---|
| **装飾だけの絵文字**（意味を持たない） | **削除する** |
| **文字で十分に意味が伝わるもの** | **日本語ラベルへ置換する** |
| **操作の認識に本当に必要なもの**（ボタン・ナビ等） | **インラインSVGにする** |

**※ SVGは「最後の手段」。まず「消せないか」「文字にできないか」を検討すること。**

**種別ごとの対応表：**

| 現在 | 置換後 | 分類 |
|---|---|---|
| `🔴 緊急` / `🟡 通常` / `🟢 連絡` | **左端3px縦帯 ＋「至急」「注意」「連絡」の文字** | **文字**（第116回⑤・下記4-2） |
| `📷 画像あり` | **`画像`**（無彩色の文字ラベル） | **文字**（第118回・条件8） |
| `📊 アンケート n/m人回答` | **`アンケート n/m`**（無彩色の文字ラベル） | **文字**（第118回・条件8） |
| `📅 7/15` | **`締切 7/15`**（無彩色の文字ラベル） | **文字**（同上） |
| `📍`（50箇所・地域セレクト） | **削除**（`<option>📍 東京都` → `<option>東京都`） | **削除**（装飾） |
| `🏨 🏥 🏠 🎡 👥 🏆`（業種セレクト） | **削除**（テキストのみ） | **削除**（装飾） |
| `📭`（空状態） | **削除**、または文字のみにする | **削除**（装飾） |
| **ボタン・ナビゲーションのアイコン**（`➕` `🗑️` `🔄` `🔒` 等で、**文字を添えても操作の認識にアイコンが要るもの**） | **Material Symbols Outlined 準拠のインラインSVG** | **SVG**（仕様書 第15-7・**CDN／npm 不使用**） |
| **上記以外**（見出しの `📋` `👥` `🔑` 等で、**文字だけで通じるもの**） | **削除する**（SVGにしない） | **削除** |

**判断に迷ったら、SVGにせず報告すること。**

### 3-3. テンプレート文面（3行）の扱い

```
L522: 📋 テンプレートから選ぶ / Templates
L793: （テンプレート設定画面の見出し）
L798: saveGroupTemplates()
```

**これらは「テンプレート機能のUI部品」であり、置換対象である。**

**ただし、テンプレートの中身（利用者が登録した文面）に含まれる絵文字は、絶対に触らないこと。** DBに保存されている文字列であり、コード側で削除してはならない。

---

## 4. Step 3：見た目の変更

### 4-1. ヘッダーをネイビーへ

```css
/* Before */
.header { background: var(--green); }

/* After */
.header { background: var(--eo-header-bg); color: var(--eo-header-fg); }
```

### 4-2. 【第118回】連絡メッセージ一覧を連続リストへ

**`renderMessages()`（L2130〜2150付近）を、以下の構造に置き換える。**

```html
<div class="eo-msg-day">今日</div>
<div class="eo-msg-list">
  <div class="eo-msg eo-msg--urgent" onclick="showDetail('...')" aria-label="重要度：至急">
    <div class="eo-msg__text">301号室 空調から異音。お客様から申告あり…</div>
    <div class="eo-msg__meta">
      <span class="eo-msg__kind">至急</span>
      <span class="eo-msg__sep">·</span>
      <span class="eo-msg__who">一郎</span>
      <span class="eo-msg__sep">·</span>
      <span class="eo-msg__time">14:20</span>
      <span class="eo-msg__label">画像</span>
      <span class="eo-msg__read">既読 4/11</span>
    </div>
  </div>
</div>
```

```css
.eo-msg-list { background: var(--eo-surface); }

.eo-msg {
  padding: 14px 16px;                    /* 【条件9】1pxも縮小しない */
  border-bottom: 1px solid var(--eo-border);
  position: relative;
  cursor: pointer;
}
.eo-msg::before {                        /* 【第116回⑤】左端3px縦帯 */
  content: ""; position: absolute; left: 0; top: 0; bottom: 0;
  width: var(--eo-bar-width);
}
.eo-msg--urgent::before  { background: var(--eo-priority-urgent); }
.eo-msg--caution::before { background: var(--eo-priority-caution); }
.eo-msg--notice::before  { background: var(--eo-priority-notice); }

.eo-msg__text {                          /* 【条件5】自動可変・最大2行 */
  font-size: 14px; line-height: 1.5; margin-bottom: 8px;
  color: var(--eo-text);
  display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden;
}

.eo-msg__meta {                          /* 【条件11】狭い画面で破綻させない */
  display: flex; flex-wrap: wrap;
  align-items: center; gap: 6px;
  font-size: 12px; line-height: 1.4;
  color: var(--eo-text-muted);
}
.eo-msg__kind { font-weight: 500; }      /* 【第116回⑤】色だけに頼らない */
.eo-msg--urgent  .eo-msg__kind { color: var(--eo-priority-urgent); }
.eo-msg--caution .eo-msg__kind { color: var(--eo-priority-caution); }
.eo-msg--notice  .eo-msg__kind { color: var(--eo-priority-notice); }
.eo-msg__sep  { color: #D8D8D4; }

/* 【条件8】画像・アンケートは無彩色の文字ラベル。3行目を作らない */
.eo-msg__label {
  font-size: 11px; color: var(--eo-text-muted);
  background: var(--eo-system-bg);
  padding: 1px 6px; border-radius: 4px;
}

/* 【条件10】「既読 4/11」と文字で。【条件3】赤にしない */
.eo-msg__read {
  margin-left: auto;
  white-space: nowrap;                   /* 【条件11】 */
  color: var(--eo-text-muted);
}
/* 【第119回・修正2】全員既読に「緑」を使ってはならない。
   --eo-priority-notice は投稿種別「連絡」の緑。ここで使うと、
   「緑の縦帯＝連絡」と「緑の文字＝全員既読」の2つの意味が同一画面に生まれる。
   赤・黄・緑の3色は、人間が投稿した連絡の重要度にのみ使う（第116回・第118回）。 */
.eo-msg__read--done {
  color: var(--eo-text-muted);
  font-weight: 600;
}

/* 【条件7】日付見出し
   ※【第119回・修正3】--eo-bg は styles.css に存在しない。
     実在する確定トークン --eo-surface-sunken（styles.css L43）を使う。 */
.eo-msg-day {
  padding: 14px 16px 8px;
  font-size: 12px; font-weight: 500;
  color: var(--eo-text-muted);
  background: var(--eo-surface-sunken);   /* 背景なしにする場合は transparent でもよい */
}
```

**削除するCSS**（`styles.css` から）：

| 削除するもの | 根拠 |
|---|---|
| `.priority-badge` / `.priority-urgent` / `.priority-normal` / `.priority-info` | **第116回⑤**（バッジ廃止） |
| `.msg-read-bar` / `.bar` / `.bar-fill` / `.bar-fill.warn` | **第118回・条件2**（プログレスバー削除） |
| **`.unread-names`** | **【第119回・修正5】削除する前に、必ず全利用箇所を検索すること**（下記） |
| `.msg-card` / `.msg-card.urgent` / `.msg-card.normal` / `.msg-card.info` / `.msg-title` / `.msg-meta` | **第118回・条件1**（カード型廃止・一覧のみ） |

#### 【第119回・修正5】`.unread-names` を一律削除してはならない

**第118回・条件4 は「一覧から削除。詳細画面には残す」である。**
**同じクラスを一覧と詳細で共有していた場合、CSSを消すと詳細画面の未読者表示まで崩れる。**

**手順（必ずこの順で）：**

```bash
grep -n "unread-names" index.html styles.css
```

| 検索結果 | 対応 |
|---|---|
| **一覧（`renderMessages()`）でしか使っていない** | **CSSごと削除してよい** |
| **詳細画面でも使っている** | **CSSを削除しない。一覧のHTML出力だけを消す。** 必要なら詳細用に `.detail-unread-names` へ分離する |

**※ 検索せずに削除しないこと。**

**削除しないCSS**：`.card`（プロフィール・アンケート・承認等で使用。**第118回・条件1**）

### 4-3. JSの変更（`renderMessages()`）

```js
// Before（L2113）
const pLabel = p === 'urgent' ? '🔴 緊急' : p === 'normal' ? '🟡 通常' : '🟢 連絡';

// After
const KIND = { urgent: '至急', normal: '注意', info: '連絡' };
const CLS  = { urgent: 'urgent', normal: 'caution', info: 'notice' };
const kindJa  = KIND[p] || '連絡';
const kindCls = CLS[p]  || 'notice';
```

**※ DB列 `priority` の値（`urgent` / `normal` / `info`）は変更しない。表示層の名前だけを整理する。**

**既読の表示（条件2・3・10）：**

```js
// Before
<div class="msg-read-bar">
  <div class="bar"><div class="bar-fill${readPct < 70 ? ' warn' : ''}" style="width:${readPct}%"></div></div>
  <div class="read-count">${readCount}/${receiverCount}人既読</div>
</div>
${unreadCount > 0 ? `<div class="unread-names">❌ 未読 ${unreadCount}名</div>` : ''}

// After ── バー削除・未読名削除・赤くしない・「既読 n/m」と文字で
const isDone = readCount >= receiverCount;
const readHtml = isDone
  ? `<span class="eo-msg__read eo-msg__read--done">全員既読</span>`
  : `<span class="eo-msg__read">既読 ${readCount}/${receiverCount}</span>`;
```

**※ `readCount` / `receiverCount` の算出方法は一切変更しない（条件12）。表示だけを変える。**

**日付見出し（条件7）：**

**※【第119回・修正4】年またぎに対応すること。** 今年以外は `2025年12月31日` の形式にする。

```js
function getDayLabel(createdAt) {
  const d = new Date(createdAt);
  const now = new Date();

  const today  = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(),   d.getMonth(),   d.getDate());

  const diff = Math.round((today - target) / 86400000);

  if (diff === 0) return '今日';
  if (diff === 1) return '昨日';

  // ★ 年が違えば年を付ける（2025年12月31日）
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  return `${d.getMonth() + 1}月${d.getDate()}日`;
}
// メッセージをループしながら、日付が変わったところで .eo-msg-day を挿入する
```

### 4-4. 角丸を9pxに統一

**現在9種類（12/10/8/20/3/2/28/1px・14px）ある。**

| 対象 | 変更 |
|---|---|
| `.card` / `.btn` / `.form-input` / 画像 / モーダル | **`var(--eo-radius)`（9px）** |
| **`border-radius: 50%`（アバター等の円）** | **変更しない** |
| **`border-radius: 999px` / `20px`（ピル型のタブ・チップ）** | **変更しない**（意図的な形状） |

### 4-5. カード背景のグラデーションを削除（第116回④）

```css
/* Before */
.msg-card.urgent { background: #fffafa; }
.msg-card.normal { background: #fffef5; }
.msg-card.info   { background: #f1f8f4; }

/* After ── 単色の白。種別は左端の縦帯だけで示す */
/* （上記の .msg-card 系は削除するため、この指定自体が消える） */
```

### 4-6. システム通知をグレーへ（仕様書 第25-3）

```css
.eo-system-bar {
  background: var(--eo-system-bg);
  color: var(--eo-system-fg);
  border: 1px solid var(--eo-system-border);
  border-radius: var(--eo-radius);
  padding: 14px 16px;
}
```

**種別の3色（赤・黄・緑）は使わない。左端の縦帯も付けない。**

### 4-7. フォント

```css
body { font-family: var(--eo-font); }   /* 'Noto Sans JP' 単独 */
```

---

## 5. Step 4：日英併記の削除と i18n 退避

### 5-1. 【必須】英訳を捨てない

**第117回 3-3・野口さん判断（2026/7/13）**：

> **一旦すべて日本語で構わない。デザインが全て直ったら、英語切り替え機能を真っ先にやりたい。**

**日英併記は 83箇所ある**（実測）。**HTMLから英語を消すと同時に、`js/i18n.js` へ退避すること。**

### 5-2. 作業手順

```html
<!-- Before -->
<label class="form-label">表示名（本名を入力してください） / Display Name</label>

<!-- After -->
<label class="form-label" data-i18n="form_display_name">表示名（本名を入力してください）</label>
```

```js
// js/i18n.js（新規・この時点では読み込まない。定義だけする）
export const ja = {
  form_display_name: '表示名（本名を入力してください）',
  btn_create_group:  '新しいグループを作る',
  btn_join_group:    'グループに参加する',
  // …83箇所すべて
};

export const en = {
  form_display_name: 'Display Name',
  btn_create_group:  'Create Group',
  btn_join_group:    'Join',
  // …83箇所すべて
};
```

**`data-i18n` 属性を付けておくと、切替実装時にそのまま使える。**

### 5-3. 受け入れ条件（Step 4 固有）

**※【第119回・修正7】キー数は83である必要はない。**

**「画面上の出現箇所が83」と「翻訳キーが83個」は同じではない。**
**同じ文言が複数箇所に出るなら、キーは共用してよい。**

- [ ] **HTMLから削除したすべての日英対訳が、再利用可能なキーとして `js/i18n.js` に保存されている**（訳し漏れゼロ）
- [ ] **同一文言はキーを共用してよい。出現数とキー数を一致させる必要はない**
- [ ] **`js/i18n.js` はどこからも読み込まれていない**（`import` が0件）
- [ ] HTMLから英語が消えている（`/ Display Name` 等が残っていない）

---

## 6. 受け入れ条件（全体）

### 6-1. 触っていないこと

- [ ] **DB列 `priority` の値を変更していない**
- [ ] **既読集計ロジック・`realReadMap` に触れていない**（条件12）
- [ ] **`signage.html` を変更していない**（条件12）
- [ ] **コメント行（`<!-- -->` / `//` / `/* */`）の絵文字を削除していない**（55行）
- [ ] **`padding: 14px 16px` を縮小していない**（条件9）
- [ ] **`.card`（一覧以外のカード型）を削除していない**（条件1）
- [ ] **【第119回・修正1】`msgs.length * 200`（月カードの高さ計算・L2073）に触れていない**（`max-height` は上限であり、中身より大きくても空白は出ない。実機で開閉不具合が出た場合のみ、別途対応する）
- [ ] **【第119回・修正5】`.unread-names` を、利用箇所を検索せずに削除していない**

### 6-2. 変わっていること

- [ ] ヘッダーがネイビー（`#1B2A3A`）
- [ ] 連絡一覧が**連続リスト**（1px区切り線）
- [ ] **1件の高さが 75px（1行）／96px（2行）**
- [ ] **種別が左端3px縦帯 ＋「至急／注意／連絡」の文字**
- [ ] **既読が「既読 4/11」と文字で表示**（`✓` を使っていない・条件10）
- [ ] **既読数が赤くない**（赤は「至急」だけ・条件3）
- [ ] **「未読7名」が一覧に無い**（詳細画面には**ある**・条件4）
- [ ] **画像・アンケートが無彩色の文字ラベル**（絵文字なし・条件8）
- [ ] **日付見出し（今日／昨日／7月11日）がある**（条件7）
- [ ] **【第119回・修正4】日付見出しが年またぎに対応している**（今年以外は `2025年12月31日`）
- [ ] メタ行が `flex-wrap: wrap`・既読数が `white-space: nowrap`（条件11）
- [ ] **【第119回・修正2】「全員既読」が緑になっていない**（`--eo-priority-notice` を使っていない。赤・黄・緑は投稿種別専用）
- [ ] **【第119回・修正3】`--eo-bg` を使っていない**（`--eo-surface-sunken` を使う。`--eo-bg` は存在しないトークン）
- [ ] **【第119回・修正6】絵文字が「削除／文字／SVG」の3分類で処理されている**（162行を機械的にSVG化していない）
- [ ] 日英併記が消え、日本語のみになっている
- [ ] **HTMLから消した日英対訳が、すべて `js/i18n.js` に退避されている**（キーは共用可）

---

## 7. コミット・タグ

```
feat(ui): Design System v1.13 - unified Step 3+4 release

Step 3（見た目の変更）と Step 4（絵文字・日英併記・種別表現）を統合実装。
第118回・条件13により、種別の縦帯変更と一覧のリスト化を同時公開する。

- ヘッダーをネイビーへ（#1B2A3A）
- 連絡一覧を連続リストへ（1px区切り線・75px/96px）
- 種別バッジを左端3px縦帯＋文字へ（第116回⑤）
- 既読プログレスバー・未読名を削除（第118回・条件2/4）
- 絵文字162箇所を整理（装飾は削除・文字化・必要なものだけインラインSVG。コメント55行は対象外）
- 日英併記83箇所を削除し、js/i18n.js へ退避（第117回 3-3・キーは共用可）
- 角丸を9pxに統一（第116回①）

Refs: EO-DEC-0116, EO-DEC-0117, EO-DEC-0118
```

**公開前タグ**：`pre-ds-step34`（切り戻し用）
**公開後タグ**：`ds-step34`

**告知**：**必要**（見た目が大きく変わるため・第117回 判定対象5）。**公開前にアプリ内のシステム通知バーで予告する。**

---

## 8. 回帰確認

### 8-1. 【最重要】

| ✅ | 項目 |
|---|---|
| | **既読人数が改訂前後で完全に一致すること**（本番相当データで新旧を突合） |
| | **投稿本文・テンプレート文面の絵文字が消えていないこと** |
| | **コメント行の `★` `→` が残っていること** |

### 8-2. 実機

| ✅ | 項目 |
|---|---|
| | LIFF実機（iOS Safari）で全15画面 |
| | LIFF実機（Android）で全15画面 |
| | **100件を実際にスクロールし、体感を確認する** |
| | **狭い画面（iPhone SE 等）でメタ行が破綻しないこと**（条件11） |
| | タップ領域が44px 以上あること |
| | `signage.html`（Fully Kiosk）が従来通り表示すること |

### 8-3. 目視

| ✅ | 項目 |
|---|---|
| | 仕様書 v1.13 第25章のモックと一致すること |
| | **赤が「至急」以外に使われていないこと**（条件3） |

---

## 9. 【Copilotへ】本PRで最も危険なこと

**絵文字の一括削除である。**

```bash
# ❌ 絶対にやってはならない
sed -i 's/[絵文字]//g' index.html
```

**これを実行すると：**

- **コメント55行が破壊される**（`★` `→` を含む構造マップ）
- **投稿本文・テンプレート文面が破壊される可能性がある**

**必ず、UI部品の162行だけを、1つずつ確認しながら置換すること。**

**判断に迷う箇所があれば、置換せずに報告すること。**
