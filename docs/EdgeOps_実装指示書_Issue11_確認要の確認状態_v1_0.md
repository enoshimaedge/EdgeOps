# EdgeOps 実装指示書 ── Issue⑪：サイネージの「確認要」を確認状態で出し分ける（第153回）

**版数**：v1.0
**作成**：2026年7月24日（金）／ Claude（設計・起案）
**根拠**：EO-DEC-0153（第153回・GO／A案）
**正本**：サイネージ機能 仕様書 v2.4
**宛先**：GitHub Copilot（PR実装）

---

## 0. この指示書の使い方

**本書だけを読んで実装できるように書いてある。** 第1章（変更対象ファイル）と第2章（変更禁止領域）を先に読むこと。

**変更は `signage.html` の3行のみである。** これを超える差分になっていたら、余計なことをしている。

---

## 1. 変更対象ファイル

| # | ファイル | 現在の行数 | 変更の可否 |
|---|---|---|---|
| 1 | **`signage.html`** | 2,324行 | **変更する（唯一の対象）** |

### 変更してはならないファイル（明示）

| ファイル | 理由 |
|---|---|
| **`index.html` / `js/ui-helpers.js`** | **スマートフォン側に同じ問題は無い**（実コードで確認済み・第6章参照）。第153回判定により今回のPRには含めない |
| **`supabase/functions/signage-fetch/index.ts`** | 第153回判定により変更禁止 |
| `js/` 配下すべて | `signage.html` は `js/` 配下を読み込まない（分割定義仕様書 第3章） |
| `styles.css` | `signage.html` は参照していない |
| SQL・RPC・RLS Policy・GRANT | **本Issueに DB変更は無い** |

**新規ファイルを作成しないこと。**

---

## 2. 変更禁止領域（絶対保護）

```
【不可侵・変更禁止】
- isConfirmed の算出（L1382）
  ※ item._fullyConfirmed / item._confirmed の判定式に一切触れない。
    既存の isConfirmed 変数を「参照するだけ」である
- handover_confirmations の集計処理
- priority === 'action' の分岐（L1383〜L1387）※既に正しく動作している
- priority === 'check' に相当する末尾の return（L1391〜L1393）※同上
- cls / itemCls の値（'priority-info' / 'info'）
- handover_notes.priority の値（'action' / 'check' / 'done'）
- カード右上の「！未確認」表示（別処理・別箇所）
- 既読集計ロジック・item_receivers の参照
- token認証・token復元・エラーコード判定（allowlist方式）
- 5分ポーリング・深夜3時リロード・60秒認証リトライ
- Fully Kiosk 関連の処理
- 投稿グループの組み立て・並び順
- 天気・WBGT・QR・LINK・アンケート
- CSSの変更全般
```

---

## 3. 背景（実装者向け）

`priority` の値は**種別名**であり、確認状態ではない。

| priority | 種別名 |
|---|---|
| `action` | 重要 |
| `check` | 通常 |
| **`done`** | **確認要** |

**`done` は「完了」を意味しない。** 値名から誤解した実装により、`done` の分岐だけ `isConfirmed` を見ずに常に「・確認済」を返していた。

その結果、同一カード内で次の矛盾が発生していた（実機・2026/7/24 20:28）。

- ラベル：**確認要・確認済**
- 右上：**！未確認**
- モーダル：**確認済（0/2名）／まだ誰も確認していません**

---

## 4. 修正内容（1箇所のみ）

**`signage.html` の `getHandoverLabel()` 内、`priority === 'done'` の分岐（L1388〜L1390）。**

**現状：**

```js
  if (item.priority === 'done') {
    return { label: '確認要・確認済', cls: 'priority-info', itemCls: 'info' };
  }
```

**修正後：**

```js
  if (item.priority === 'done') {
    return isConfirmed
      ? { label: '確認要・確認済', cls: 'priority-info', itemCls: 'info' }
      : { label: '確認要・未確認', cls: 'priority-info', itemCls: 'info' };
  }
```

**要点：**

- **`isConfirmed` は L1382 で既に算出されている。** そのまま参照するだけであり、**新しく計算しないこと**
- **`cls` と `itemCls` は両方の分岐とも `'priority-info'` / `'info'` のまま。** 変更しないこと
- 語幹「確認要」は変更しない
- **`action` / `check` の分岐と同じ三項演算子の形にする。** 既存2箇所の書き方に合わせること

---

## 5. 修正後の全体像（参考）

修正後、`getHandoverLabel()` は次のようになる。**3つの分岐すべてが `isConfirmed` を参照する形に揃う。**

```js
function getHandoverLabel(item) {
  const isConfirmed = item._fullyConfirmed || item._confirmed > 0;
  if (item.priority === 'action') {
    return isConfirmed
      ? { label: '重要・対応済', cls: 'priority-urgent', itemCls: 'urgent' }
      : { label: '重要・未確認', cls: 'priority-urgent', itemCls: 'urgent' };
  }
  if (item.priority === 'done') {
    return isConfirmed
      ? { label: '確認要・確認済', cls: 'priority-info', itemCls: 'info' }
      : { label: '確認要・未確認', cls: 'priority-info', itemCls: 'info' };
  }
  return isConfirmed
    ? { label: '通常・確認済', cls: 'priority-normal', itemCls: 'normal' }
    : { label: '通常・未確認', cls: 'priority-normal', itemCls: 'normal' };
}
```

**`action` の分岐と末尾の return は1文字も変更しないこと。**

---

## 6. スマートフォン側を変更しない理由（実コードで確認済み）

**スマートフォン側に同じ問題は存在しない。**

`js/ui-helpers.js` の `renderHandoverCardHtml()`（L229〜）は、種別と確認状態を**別々に表示する構造**である。

```js
const pLabels = { action: t('hw_action'), check: t('hw_check'), done: t('hw_done') };
// → 「重要」「通常」「確認要」のみ。接尾辞を持たない

// 確認状態は statusHtml として別行に生成される（L241〜）
```

種別ラベルに確認状態を連結していないため、**`done` だから常に確認済、という誤りが起きる余地がない。**

**したがって修正対象は `signage.html` のみである。** `index.html` / `js/ui-helpers.js` を変更しないこと。

---

## 7. 実装してはならないこと（明示）

| # | 禁止事項 | 理由 |
|---|---|---|
| 1 | `isConfirmed` の算出（L1382）を変更する | **絶対保護。** 参照するだけである |
| 2 | `action` / `check` の分岐を変更する | 既に正しく動作している |
| 3 | `cls` / `itemCls` を変更する | 色は変わらない |
| 4 | 語幹「確認要」を変更する | スマートフォンと一致している |
| 5 | カード右上の「！未確認」表示に触れる | 別処理・別箇所 |
| 6 | `index.html` / `js/ui-helpers.js` を変更する | **スマホ側に問題は無い**（第6章） |
| 7 | `signage-fetch` を変更する | 第153回判定により禁止 |
| 8 | `handover_confirmations` の集計処理に触れる | 絶対保護 |
| 9 | CSSを変更する | 不要 |
| 10 | 新規ファイルを作成する | 不要 |

---

## 8. PR に必ず記載すること

```
## 対象
- signage.html のみ（他ファイルは無変更）

## 変更した箇所（1箇所・3行）
- L1388-1390 : getHandoverLabel() の priority === 'done' 分岐を
                isConfirmed で出し分けるように変更

## 触れていないことの確認
- [ ] isConfirmed の算出（L1382）を変更していない
- [ ] action / check の分岐を変更していない
- [ ] cls / itemCls を変更していない
- [ ] handover_confirmations の集計処理に触れていない
- [ ] カード右上の「！未確認」表示に触れていない
- [ ] 既読集計ロジック・item_receivers の参照に触れていない
- [ ] token認証・エラー分類・5分ポーリングに触れていない
- [ ] index.html / js/ui-helpers.js を変更していない
- [ ] signage-fetch を変更していない
- [ ] CSSを変更していない
- [ ] 新規ファイルを作成していない
```

---

## 9. 野口さん側の作業

| # | 作業 |
|---|---|
| 1 | PR マージ前に切り戻しタグを打つ：`pre-handover-done-fix`（**Target を `main` にする前にマージしないこと**） |
| 2 | 本番反映後、サイネージ端末で実機確認（第10章） |
| 3 | **Fully Kiosk を終了・再起動する**（キャッシュ対策） |

**タグを打ち忘れてマージした場合でも、PR画面の「Revert」ボタンで切り戻せる。**

---

## 10. 実機確認の項目

**確認に使うデータ**：種別「確認要」で投稿した引き継ぎノート

| # | 確認内容 | 期待値 |
|---|---|---|
| **1** | **誰も確認していない「確認要」の引き継ぎ** | **確認要・未確認** |
| **2** | 同カードの右上 | **！未確認**（ラベルと矛盾しない） |
| **3** | モーダルを開く | 「確認済（0/2名）」と表示が整合する |
| **4** | 誰かが確認した後 | **確認要・確認済**に変わる |
| 5 | 「重要」の引き継ぎ | **重要・未確認／重要・対応済**（変わっていない） |
| 6 | 「通常」の引き継ぎ | **通常・未確認／通常・確認済**（変わっていない） |
| 7 | ラベルの色（緑） | **変わっていない** |
| 8 | 連絡の種別（至急／注意／連絡） | 変わっていない |
| **9** | **5分待つ** | **画面が維持される。「サイネージが無効になりました」が出ない** |

**1〜4 が本Issueの核心である。** ラベル・右上表示・モーダルの3箇所が矛盾しないことを必ず確認すること。

**4 を確認するには、スマートフォンから「引き継ぎました」または「対応しました」を押す必要がある。**

---

## 11. 参照文書

| 文書 | 該当箇所 |
|---|---|
| EO-DEC-0153（第153回判定） | **本書の根拠** |
| EO-DEC-0151（第151回） | getHandoverLabel の label 変更を追加例外として許可 |
| EO-DEC-0142（第142回） | signage.html の5関数限定 |

以上。
