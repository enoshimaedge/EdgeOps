# EdgeOps 実装指示書 ── Issue⑦：英語表示の翻訳漏れ

**版数**：v2.0（実コードで所在を特定し、行番号を確定）
**作成**：2026年7月24日（金）／ Claude（設計・起案）
**根拠**：EO-DEC-0149 第7章（バグ修正として対応可・判定不要）
**関連**：EO-DEC-0120（JA/EN基盤）／EO-DEC-0121（翻訳対象の限定）
**宛先**：GitHub Copilot（PR実装）

---

## 0. この指示書の使い方

**本件は明確なバグ（翻訳漏れ）であり、判定事項ではない。**

**Issue⑥（投稿グループの視認性）とは別PRにすること。** 第149回判定の条件により、差分を分ける。

**v2.0 の変更点**：`js/ui-helpers.js` を実コードで確認し、所在と行番号を確定した。あわせて、当初報告の2件に加えて**未報告の翻訳漏れ2件**が同じ関数内に見つかったため対象に含めた。

---

## 1. 実コードで確定した所在

**すべて `js/ui-helpers.js`（475行）にある。**

| # | 行 | 現在のコード | 種別 |
|---|---|---|---|
| 1 | **L384** | `el.textContent = 'URLが未発行です。「URL発行・再生成」をタップしてください。';` | 当初報告 |
| 2 | **L376** | `el.textContent = 'サイネージURLが発行済みです';` | **追加発見** |
| 3 | **L380** | `el.textContent = 'サイネージは無効化されています';` | **追加発見** |
| 4 | **L429** | `if (diff < 60000) return 'たった今';` | 当初報告（相対時刻） |
| 5 | **L430** | `if (diff < 3600000) return \`${Math.floor(diff/60000)}分前\`;` | 当初報告（相対時刻） |

**1〜3 は同じ関数 `updateSignageUrlDisplay()`（L371〜L388）の3分岐である。** 1だけ直すと、他の2分岐が日本語のまま残り、かえって不統一になる。**3つまとめて対応する。**

**4〜5 は `formatTime()`（L426〜L433）にある。**

### 1-1 【重要】「時間前」は存在しない

当初「4分前」「24分前」「30分前」を報告したが、**実コードに「時間前」の分岐は無い。**

```js
function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString); const now = new Date(); const diff = now - d;
  if (diff < 60000) return 'たった今';                                    // ← L429
  if (diff < 3600000) return `${Math.floor(diff/60000)}分前`;             // ← L430
  if (diff < 86400000) return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;  // 時刻表記
  return `${d.getMonth()+1}/${d.getDate()}`;                              // 日付表記
}
```

**1時間以上経つと「5:31」のような時刻表記になる。** したがって追加する翻訳キーは**「たった今」「N分前」の2つだけでよい。** `time_hour_ago` は不要である。

### 1-2 対象外（触れないこと）

**L431（時刻表記）・L432（日付表記）は本Issueの対象外とする。**

第121回で翻訳対象を主要5画面に限定した経緯があり、日付・時刻の書式を英語圏形式（`5:31 PM` / `Jul 9`）へ変えるかは別途判断が必要である。**触れないこと。**

---

## 2. `t()` は `ui-helpers.js` から呼べる（確認済み）

**確認結果：呼べる。追加の対応は不要である。**

- `t()` は `index.html` L935 で `function t(key, params = {})` として定義されている
- `ui-helpers.js` は **L103 と L230 で既に `t()` を使用している**（`t('label_image_exists')` / `t('hw_action')` 等）
- 読込順は `js/i18n.js` → `js/ui-helpers.js` → …（index.html L901〜L906）であり、実行時には `t()` が存在する

**したがって、そのまま `t()` を呼んでよい。** グローバル昇格などの追加対応は不要であり、**行ってはならない**（分割定義仕様書 第5章）。

---

## 3. 変更対象ファイル

| # | ファイル | 現在 | 変更内容 |
|---|---|---|---|
| 1 | **`js/i18n.js`** | 388行 | 翻訳キーを追加（ja / en 両方） |
| 2 | **`js/ui-helpers.js`** | 475行 | 日本語直書きを `t()` 呼び出しへ置換（5箇所） |
| 3 | **`index.html`** | 4,380行 | **キャッシュクエリの更新のみ**（第6章） |

### 変更してはならないファイル

| ファイル | 理由 |
|---|---|
| `signage.html` | **`js/i18n.js` を読み込まない**（分割定義仕様書 第3章「サイネージの独立」）。サイネージは日本語固定（第120回⑨） |
| `js/image.js` / `js/templates.js` / `js/survey.js` / `js/report.js` | 本Issueに変更は無い |
| `js/auth.js` | 同上 |
| `styles.css` | 同上 |
| `supabase/functions/` 配下 | 本Issueに Edge Function の変更は無い |
| SQL・RPC・RLS Policy・GRANT | **本Issueに DB変更は無い** |

**新規ファイルを作成しないこと。**

---

## 4. 変更禁止領域

```
【不可侵・変更禁止】
- DB・RPC・Policy・GRANT
- 既読集計ロジック・realReadMap・read_receipts・receiver_count 計算
- formatTime() の「時刻の計算ロジック」
  ※出力する文言だけを t() 経由にする。diff の計算・閾値（60000 / 3600000 /
    86400000）・時刻表記（L431）・日付表記（L432）には触れない
- updateSignageUrlDisplay() の分岐条件・el.style.color の値・copyBtn の表示制御
  ※表示する文言のみを t() 経由にする
- generateSignageToken() の処理本体（保護4関数・絶対保護）
- renderPostGroupHtml()（Issue⑥で変更するため、本PRでは触れない）
- signage.html / signage-fetch
- window.EdgeOpsI18n の名前空間形式（第120回④）
- ローカル関数のグローバル昇格（分割定義仕様書 第5章）
```

---

## 5. 修正内容

### 5-1 `js/i18n.js` へキーを追加（4キー × ja/en）

**既存キーは1つも変更・削除しないこと。** 追加のみ行う。

**`ja` ブロックの末尾（L194 `toast_templates_saved:` の次の行）に追加：**

```js
    // ── サイネージ管理・相対時刻（Issue⑦で追加）──────────────────
    desc_signage_issued:        'サイネージURLが発行済みです',
    desc_signage_disabled:      'サイネージは無効化されています',
    desc_signage_not_issued:    'URLが未発行です。「URL発行・再生成」をタップしてください。',
    time_just_now:              'たった今',
    time_min_ago:               '{n}分前',
```

**`en` ブロックの末尾（`ja` と同じ並び順の位置）に追加：**

```js
    // ── サイネージ管理・相対時刻（Issue⑦で追加）──────────────────
    desc_signage_issued:        'Signage URL has been issued',
    desc_signage_disabled:      'Signage is disabled',
    desc_signage_not_issued:    'No URL issued yet. Tap "Regenerate token".',
    time_just_now:              'Just now',
    time_min_ago:               '{n} min ago',
```

**要点：**

- `{n}` は既存の `read_count: '既読 {read}/{total}'` と同じ差し込み方式である（第120回⑤の `t(key, params)`）
- **ja と en のキー数を必ず一致させること。** 現在 159キー → **164キー** になる
- 英語に無いキーがあると `console.warn` が出る（第120回⑥・受け入れ条件：警告0件）

### 5-2 `updateSignageUrlDisplay()` の3分岐（L376 / L380 / L384）

**変更前：**

```js
    el.textContent = 'サイネージURLが発行済みです';          // L376
    el.textContent = 'サイネージは無効化されています';        // L380
    el.textContent = 'URLが未発行です。「URL発行・再生成」をタップしてください。';  // L384
```

**変更後：**

```js
    el.textContent = t('desc_signage_issued');       // L376
    el.textContent = t('desc_signage_disabled');     // L380
    el.textContent = t('desc_signage_not_issued');   // L384
```

**`el.style.color` の値（`#0F6B63` / `#e53935` / `var(--text-light)`）・分岐条件・`copyBtn` の表示制御は一切変更しないこと。**

### 5-3 `formatTime()` の2箇所（L429 / L430）

**変更前：**

```js
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return `${Math.floor(diff/60000)}分前`;
```

**変更後：**

```js
  if (diff < 60000) return t('time_just_now');
  if (diff < 3600000) return t('time_min_ago', { n: Math.floor(diff/60000) });
```

**要点：**

- **閾値（`60000` / `3600000`）を変更しないこと**
- **`Math.floor(diff/60000)` の計算式を変更しないこと**
- **L431（時刻表記）・L432（日付表記）には一切触れないこと**

---

## 6. キャッシュクエリの更新（必須）

**`js/i18n.js` と `js/ui-helpers.js` を変更するため、`index.html` の script タグを更新する。**

| 行 | 現在 | 更新後 |
|---|---|---|
| **L901** | `js/i18n.js?v=20260723-4` | `js/i18n.js?v=20260724-1` |
| **L902** | `js/ui-helpers.js?v=20260704-2` | `js/ui-helpers.js?v=20260724-1` |

**変更していないファイル（templates / survey / report）のクエリは更新しないこと。**

**これを忘れると、利用者の端末で古いJSが読み込まれ続け、修正が反映されない**（学び119）。

---

## 7. PR に必ず記載すること

```
## 対象
- js/i18n.js（キー追加のみ・5キー × ja/en）
- js/ui-helpers.js（5箇所を t() 経由へ）
- index.html（キャッシュクエリ2行のみ）

## 変更した行
- js/i18n.js   : ja/en 末尾へ5キー追加（159 → 164キー）
- ui-helpers.js: L376 / L380 / L384（updateSignageUrlDisplay）
- ui-helpers.js: L429 / L430（formatTime）
- index.html   : L901 / L902（キャッシュクエリ）

## 触れていないことの確認
- [ ] DB・RPC・Policy・GRANT を変更していない
- [ ] 既読集計・realReadMap の計算に触れていない
- [ ] formatTime() の閾値・計算式・時刻表記(L431)・日付表記(L432) に触れていない
- [ ] updateSignageUrlDisplay() の分岐条件・style.color・copyBtn 制御に触れていない
- [ ] generateSignageToken() の処理本体に触れていない
- [ ] renderPostGroupHtml() に触れていない（Issue⑥の対象のため）
- [ ] signage.html / signage-fetch を変更していない
- [ ] 既存の翻訳キーを変更・削除していない
- [ ] ja と en のキー数が一致している（164キー）
- [ ] ローカル関数のグローバル昇格を行っていない
- [ ] キャッシュクエリを2行とも更新した
- [ ] 新規ファイルを作成していない
```

---

## 8. 野口さん側の作業

| # | 作業 |
|---|---|
| 1 | **PR マージ前に切り戻しタグを打つ**：`pre-i18n-fix` |
| 2 | 本番反映後、実機確認（第9章） |
| 3 | **表示が変わらない場合、LINEアプリを完全終了して開き直す**（学び119） |

---

## 9. 実機確認の項目

| # | 確認内容 | 期待値 |
|---|---|---|
| 1 | **英語**・プロフィール画面（URL未発行の状態） | `No URL issued yet. Tap "Regenerate token".` |
| 2 | **英語**・トークン発行後 | `Signage URL has been issued` |
| 3 | **英語**・一覧の時刻（1時間以内の投稿） | `4 min ago` 等 |
| 4 | **英語**・1分以内の投稿 | `Just now` |
| 5 | **英語**・1時間以上前の投稿 | **`5:31` のまま**（対象外・変わっていないこと） |
| 6 | **日本語**に戻す・時刻 | 「4分前」「たった今」・**従来どおり** |
| 7 | **日本語**・プロフィール画面 | 従来どおりの日本語 |
| 8 | ブラウザのコンソール | **`console.warn` が0件**（第120回⑥の受け入れ条件） |
| 9 | 既読の数字 | **変わっていない** |
| 10 | サイネージ画面（signage.html） | **日本語のまま・変わっていない** |
| 11 | 引き継ぎ画面の時刻表示 | 言語に応じて切り替わる（`formatTime` は共用のため） |

**5・6・7 を必ず確認すること。** 英語化の過程で、対象外の表記や日本語表示を壊していないことの確認である。

---

## 10. 参照文書

| 文書 | 該当箇所 |
|---|---|
| EO-DEC-0149 | 第7章（本件をバグ修正として対応可・PRを分ける条件） |
| EO-DEC-0120 | JA/EN基盤（名前空間形式・`t(key, params)`・警告0件） |
| EO-DEC-0121 | 翻訳対象を主要5画面に限定 |
| 分割定義仕様書 v1.3 | 第3章（サイネージの独立）・第5章（グローバル昇格の禁止） |

以上。
