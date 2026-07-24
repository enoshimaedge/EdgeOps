# EdgeOps 実装指示書 ── Issue⑥：投稿グループの視認性（第149回＋第150回）

**版数**：v2.0
**作成**：2026年7月24日（金）／ Claude（設計・起案）
**根拠**：EO-DEC-0149（第149回・条件付きGO）＋ **EO-DEC-0150（第150回・GO）**
**正本**：EdgeOps「引用して全員に返信」機能 仕様書 v1.8 第30章
**宛先**：GitHub Copilot（PR実装）

---

## 0. この指示書の使い方

**本書だけを読んで実装できるように書いてある。** 第1章（変更対象ファイル）と第2章（変更禁止領域）を先に読むこと。

**本件は表示のみの変更である。DB・RPC・Policy・GRANT・既読集計には一切触れない。**

**v2.0 の変更点**：第150回判定（GO）により【修正④】を追加した。第150回は「第149回の実装指示に本件を含め、まとめて1PRで実装してよい」と定めているため、本書1本で実装する。

**翻訳漏れの修正（Issue⑦）は本PRに含めないこと。** 第149回判定の条件により、差分を分ける。

---

## 1. 変更対象ファイル

| # | ファイル | 現在の行数 | 変更の可否 |
|---|---|---|---|
| 1 | **`index.html`** | **4,380行** | **変更する（唯一の対象）** |

### 変更してはならないファイル（明示）

| ファイル | 理由 |
|---|---|
| `signage.html` | **第149回⑤で「変更しない」と判定済み**。サイネージ側は既に元投稿 priority を用いており本問題は発生していない |
| `supabase/functions/signage-fetch/index.ts` | 本Issueに Edge Function の変更は無い |
| `js/i18n.js` | **Issue⑦（翻訳漏れ）で扱う。本PRでは変更しない** |
| `js/ui-helpers.js` / `js/image.js` / `js/templates.js` / `js/survey.js` / `js/report.js` | 本Issueに変更は無い |
| `js/auth.js` | 同上 |
| `styles.css` | **既存クラスを流用するため変更不要**（第4章参照） |
| SQL・RPC・RLS Policy・GRANT | **本Issueに DB変更は無い** |

**新規ファイルを作成しないこと。**

---

## 2. 変更禁止領域（絶対保護）

```
【不可侵・変更禁止】
- DB・RPC・Policy・GRANT（本件は表示のみの変更）
- messages.priority の保存値（第116回⑤：DB列 priority の値は変更しない）
  ※返信投稿は今後も priority='info' で保存される。表示だけを変える。
- 既読集計ロジック・realReadMap・read_receipts・receiver_count 計算
- eoReceiverCountOf() / eoReadHtmlOf() の計算内容
- buildPostGroups() の畳み込みロジック（L2287〜）
- toggleRootPost() の開閉処理・月カードの max-height 追随（L2428〜）
- 折りたたみ行の文字色・矢印（▶▼）・フォントサイズ・padding（第150回の条件）
- 単独投稿の描画（L2606付近の renderMessages 内）
- 日付見出し・月カードの挙動
- 詳細画面（renderDetailThread）
- 保護4関数（restoreSession / joinGroup / generateSignageToken / ensureCurrentUser）
- syncProfileForm() の構造・profileFormGroupId ガード
- signage.html / signage-fetch
```

---

## 3. 変更箇所（1関数のみ）

**変更するのは `renderPostGroupHtml()`（L2362〜L2425）だけである。**

この関数以外に手を入れないこと。5行を超える変更が他の関数に必要になった場合は、実装を止めて報告すること。

---

## 4. 修正内容

### 4-1 【修正①】返信行の縦帯を元投稿の色にする

**現状（L2376）：**

```js
<div class="eo-msg eo-msg--notice" onclick="showDetail('${latest.id}')" aria-label="重要度：${latestKindJa}">
```

**`eo-msg--notice` がハードコードされている。** これが「返信が必ず緑になる」原因である。

**修正後：**

```js
<div class="eo-msg eo-msg--${rootKindCls}" onclick="showDetail('${latest.id}')" aria-label="${rootKindJa}の引用返信">
```

**要点：**
- `eo-msg--notice` → **`eo-msg--${rootKindCls}`**（元投稿の priority クラスを使う）
- `rootKindCls` は L2367 で既に算出済み（`CLS[rp] || 'notice'`）。**新しい変数を作らないこと。**
- `aria-label` は **「注意の引用返信」** のような文言にする（第149回②の条件）

**CSSクラスは既存のものを流用する。** `eo-msg--urgent` / `eo-msg--caution` / `eo-msg--notice` は既に定義済みであり、**`styles.css` を変更する必要はない。**

### 4-2 【修正②】返信行のメタラベルを元投稿の種別名にする

**現状（L2383）：**

```js
<span class="eo-msg__kind">${t('label_reply_badge')}</span>
```

`label_reply_badge` は「返信 / Reply」であり、縦帯の色と意味が食い違う。

**修正後：**

```js
<span class="eo-msg__kind">${rootKindJa}</span>
```

**要点：**
- `rootKindJa` は L2366 で既に算出済み（`KIND[rp] || t('priority_notice')`）。**新しい変数を作らないこと。**
- これにより「至急 / 注意 / 連絡」が元投稿と同じ色・同じ文字で表示される
- **返信であることは、行頭の `label_reply_prefix`（【引用返信】）が伝える**（L2378・変更しない）

**`label_reply_badge` のキー自体は削除しないこと。** L3735 で別の用途に使われている。

### 4-3 【修正③】投稿グループの下に余白を入れる

**現状（L2400〜L2422）：** `rootRow` の最も外側の `div` に余白が無い。

**修正後：** 最も外側の `div` に `margin-bottom` を追加する。

```js
const rootRow = `
    <div style="border-top:1px solid var(--border); margin-bottom:10px;">
```

**要点：**
- **`margin-bottom: 10px`** とする（第149回④の推奨値）
- **単独投稿には余白を付けないこと。** 本修正は `renderPostGroupHtml()` の中だけで行う
- **カード化しないこと**（枠線・背景色・角丸を追加しない）。第118回 条件1（カード型廃止・連続リスト）を維持する

### 4-4 【修正④】折りたたみ行の左端に縦帯を付ける（第150回・A案）

**目的は種別を伝えることではなく、投稿グループの範囲を示すことである。**

投稿グループは「返信行」「折りたたみ行」「元投稿」の3ブロックで1セットだが、現在は真ん中の折りたたみ行だけ縦帯が無く、色付きの帯が上下に分断されている。これを1本につなげる。

**現状（L2400〜L2402）：**

```js
const rootRow = `
    <div style="border-top:1px solid var(--border);">
      <div onclick="toggleRootPost('${bodyId}')"
           style="display:flex; align-items:center; gap:6px; padding:8px 16px; cursor:pointer;">
```

**修正後：** 折りたたみ行の `div`（`onclick="toggleRootPost(...)"` を持つ側）に、既存の縦帯クラスを付与する。

```js
const rootRow = `
    <div style="border-top:1px solid var(--border); margin-bottom:10px;">
      <div class="eo-msg--${rootKindCls}" onclick="toggleRootPost('${bodyId}')"
           style="display:flex; align-items:center; gap:6px; padding:8px 16px; cursor:pointer;">
```

**要点：**

- **`eo-msg` クラスは付けないこと。** `eo-msg--${rootKindCls}` のみを付ける。`eo-msg` を付けると、一覧行としての padding・レイアウトが適用され、折りたたみ行の見た目が崩れる
- **既存の `eo-msg--urgent` / `eo-msg--caution` / `eo-msg--notice` を流用する。** `styles.css` に新しいクラスを追加しないこと
- **`rootKindCls`（L2367）をそのまま使う。** 新しい変数を作らないこと

**★ 実装上の確認事項（重要）**

`eo-msg--*` クラスが `border-left` 以外の指定（padding・background 等）を含む場合、折りたたみ行のレイアウトが崩れる可能性がある。**`styles.css` で `.eo-msg--urgent` 等の定義を確認すること。**

- **`border-left` のみを持つ場合** → 上記のとおりクラス付与でよい
- **他の指定も含む場合** → クラスを使わず、`style` 属性に `border-left` を直接書く。値は `styles.css` の `.eo-msg--*` と**完全に同じ幅・同じ色変数**にすること（例：`border-left:3px solid var(--eo-priority-caution);`）。ただしこの場合、3色の出し分けが必要になるため、`rootKindCls` から色変数を引く小さなマップを関数内に置いてよい

**どちらを採ったかを PR に必ず記載すること。**

### 4-5 【変更しない】折りたたみ行の文字・矢印・padding

**第150回の条件により、次は一切変更しないこと。**

- 「▶ 元の連絡」の**文字色**（`--text-mid` / `--text-light` のまま・無彩色を維持）
- **矢印**（▶ ▼）の文字・色・サイズ
- **フォントサイズ**（12px）
- **padding**（`8px 16px`）
- **開閉処理**（`toggleRootPost()`）

**色を付けるのは左端の縦帯のみである。** 第149回③の趣旨（折りたたみ行が操作要素として見えること）はここで維持される。

### 4-6 【変更しない】展開後の元投稿

**L2409 は既に `eo-msg--${rootKindCls}` になっており正しい。変更不要である。**

---

## 5. 修正の要約

| # | 行 | 変更前 | 変更後 | 根拠 |
|---|---|---|---|---|
| ① | L2376 | `eo-msg--notice` | `eo-msg--${rootKindCls}` | 第149回① |
| ① | L2376 | `aria-label="重要度：${latestKindJa}"` | `aria-label="${rootKindJa}の引用返信"` | 第149回② |
| ② | L2383 | `${t('label_reply_badge')}` | `${rootKindJa}` | 第149回② |
| ③ | L2401 | `style="border-top:..."` | `style="border-top:...; margin-bottom:10px;"` | 第149回④ |
| **④** | **L2402** | `<div onclick="toggleRootPost(...)"` | `<div class="eo-msg--${rootKindCls}" onclick="toggleRootPost(...)"` | **第150回** |

**実質5行の変更である。** これを大きく超える差分になっていたら、余計なことをしている。

---

## 6. 未使用になる変数について

修正②により、**`latestKindJa`（L2369）が未使用になる。**

**この変数と、その算出元 `lp`（L2368）は削除してよい。** ただし削除する場合は2行のみとし、他の行に影響を与えないこと。**削除せず残しても動作上の問題は無い**ため、判断に迷う場合は残すこと。

---

## 7. 実装してはならないこと（明示）

| # | 禁止事項 | 理由 |
|---|---|---|
| 1 | `messages.priority` の保存値を変更する | 第149回①：DBは `info` のまま（B案は不採用） |
| 2 | RPC `create_reply_with_receivers` を変更する | 同上。表示のみの変更である |
| 3 | 投稿グループをカードで囲う（枠線・背景・角丸） | 第149回④：イ案は不採用。第118回 条件1を維持 |
| 4 | 折りたたみ行の**文字・矢印・padding**に色やサイズ変更を加える | 第150回：色を付けるのは**左端の縦帯のみ** |
| 4b | 折りたたみ行に `eo-msg` クラスを付ける | 一覧行のレイアウトが適用され見た目が崩れる |
| 5 | 単独投稿に `margin-bottom` を付ける | 本件は投稿グループのみが対象 |
| 6 | `styles.css` に新しいクラスを追加する | 既存の `eo-msg--*` を流用する |
| 7 | `js/i18n.js` を変更する | **Issue⑦で扱う。PRを分ける（第149回の条件）** |
| 8 | `signage.html` を変更する | 第149回⑤：変更しない |
| 9 | 既読集計・`eoReadHtmlOf()` に触れる | 絶対保護 |

---

## 8. PR に必ず記載すること

```
## 対象
- index.html のみ（他ファイルは無変更）

## 変更した関数
- renderPostGroupHtml() のみ

## 変更内容（5箇所）
- L2376: eo-msg--notice → eo-msg--${rootKindCls}            [第149回①]
- L2376: aria-label を「${rootKindJa}の引用返信」へ          [第149回②]
- L2383: label_reply_badge → rootKindJa                      [第149回②]
- L2401: margin-bottom:10px を追加                           [第149回④]
- L2402: 折りたたみ行に eo-msg--${rootKindCls} を付与        [第150回]

## 第150回の実装方式（4-4の★を参照）
- [ ] 既存クラス付与で実装した（.eo-msg--* が border-left のみだった）
- [ ] style属性に border-left を直接書いた（.eo-msg--* が他の指定も含んでいたため）
  → 使用した値: ______________________

## 触れていないことの確認
- [ ] DB・RPC・Policy・GRANT を変更していない
- [ ] messages.priority の保存値を変更していない
- [ ] 既読集計・realReadMap・eoReadHtmlOf の計算に触れていない
- [ ] buildPostGroups / toggleRootPost に触れていない
- [ ] 単独投稿の描画に触れていない
- [ ] 詳細画面（renderDetailThread）に触れていない
- [ ] styles.css / js/ 配下 / signage.html / signage-fetch を変更していない
- [ ] js/i18n.js を変更していない（Issue⑦で扱うため）
- [ ] カード化していない（枠線・背景・角丸を追加していない）
- [ ] 折りたたみ行の文字色・矢印・フォントサイズ・padding を変更していない
- [ ] toggleRootPost() の開閉処理に触れていない
- [ ] styles.css に新しいクラスを追加していない
- [ ] 新規ファイルを作成していない
```

---

## 9. 野口さん側の作業（Copilot は実施しない）

| # | 作業 |
|---|---|
| 1 | **PR マージ前に切り戻しタグを打つ**：`pre-postgroup-color` |
| 2 | 本番反映後、実機確認（第10章） |
| 3 | **表示が変わらない場合、LIFFのキャッシュを疑う。** LINEアプリを完全終了して開き直す（学び119） |

---

## 10. 実機確認の項目

| # | 確認内容 | 期待値 |
|---|---|---|
| 1 | **至急**の元投稿への返信 | 返信行の縦帯が**赤**。ラベルが「**至急**」 |
| 2 | **注意**の元投稿への返信 | 返信行の縦帯が**黄**。ラベルが「**注意**」 |
| 3 | **連絡**の元投稿への返信 | 返信行の縦帯が**緑**。ラベルが「**連絡**」 |
| 4 | 折りたたみ行（▶ 元の連絡）の**左端** | **元投稿と同じ色の縦帯**が付いている |
| 4b | 折りたたみ行の**文字と矢印** | **無彩色のまま**（色が付いていないこと） |
| 4c | 投稿グループ全体の縦帯 | **返信行→折りたたみ行→元投稿が1本の線でつながる** |
| 4d | 折りたたみ行のタップ | **従来どおり開閉できる**（レイアウトが崩れていない） |
| 5 | 元投稿を開く | 従来どおり元投稿の色で表示される |
| 6 | 投稿グループの下 | **余白があり、次のグループと区別できる** |
| 7 | 単独投稿（返信なし） | **従来どおり**。余白が増えていない |
| 8 | 行頭の「【引用返信】」 | 従来どおり表示される |
| 9 | 既読の数字 | **変わっていない**（既読 0/2 等） |
| 10 | 詳細画面 | 変わっていない |
| 11 | 月カードの開閉 | 従来どおり動作する |
| 12 | 英語表示に切替 | ラベルが Urgent / Caution / Notice になる |

**1〜3（第149回）と 4・4c（第150回）が本Issueの核心である。**

- 至急の元投稿への返信が**赤**で表示されること
- 投稿グループの縦帯が**上から下まで1本につながる**こと
- 余白によって**次のグループと区別できる**こと

**この3点を必ず実機で確認すること。**

---

## 11. 参照文書

| 文書 | 該当箇所 |
|---|---|
| EO-DEC-0149（第149回判定） | **本書の根拠**（修正①②③） |
| EO-DEC-0150（第150回判定） | **本書の根拠**（修正④） |
| `EdgeOps_引用して全員に返信機能仕様書_v1_8.docx` | 第13章（一律info）・第30章 |
| EO-DEC-0116 | ⑤ 色だけを情報伝達手段にしない |
| EO-DEC-0118 | 条件1（カード型廃止）・条件3（赤は至急だけ） |

以上。
