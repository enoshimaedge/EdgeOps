# EdgeOps 実装指示書 Issue⑱
## E11:admin.html 超管理者ダッシュボードのイベント対応(第19章)

**版**:v1.0 / **作成**:2026/7/27
**根拠**:仕様書v1.9 第19章(確定済み仕様。表示・集計の追加のみ。「認証・DB・既存RPCには触れない」)
**前提**:Issue⑬〜㉒ マージ済み

> **行番号は 2026/7/27 時点 main の実測値。行番号ではなく関数名・要素ID・定数名で対象を特定すること。**

---

## 0. 絶対条件

- **表示・集計の追加のみ**。認証(liff/resolveEoUid)・DB書込み・RPC・既存6業種の表示・Storage使用量・メンバー一覧には触れない(第19章)
- 上段の統計カード(アクティブグループ数・アクティブメンバー数・総メンバー等)は**現状維持**。期限切れ除外の適用範囲は**業種内訳と2分類サマリのみ**(19-2の明記範囲。それ以外への拡大はしない)
- 19-3(スクロール・並び順の是正)は 7/17 実施済みのため**対象外**。19-4(ページング)も対象外

## 1. 変更対象ファイル(この1つ以外を変更しないこと)

1. `admin.html`

**変更禁止**:`index.html`、`js/` 配下すべて、`signage.html`、`styles.css`、`supabase/functions/` 配下すべて

## 2. 実コードで確認済みの現状(2026/7/27 main)

| # | 事実 |
|---|---|
| 1 | 業種内訳の集計は `counts = { hotel, clinic, care, attraction, freelance, club }`(L624)。event キーが無いため event グループは**どこにも集計されない** |
| 2 | ラベルは `INDUSTRY_LABELS`(L507・6業種)と `INDUSTRY_SHORT`(L632・6業種)。グループタブのタグ(L743)も INDUSTRY_LABELS を参照(未定義業種は生の 'event' 文字列が出る) |
| 3 | アクティブ判定は「承認済みメンバー1人以上」(L590-592)のみで、**expires_at は見ていない**。業種内訳用の取得は `select('id, industry')`(L587)で expires_at を取っていない |
| 4 | バー色は `.bar-hotel` 〜 `.bar-club` の6クラス(L219-224)。タグ色は `.industry-tag.clinic/care/attraction`(L267-269) |

## 3. 実装内容

### 3-1. 取得列に expires_at を追加(19-2 の前提)

```js
// 変更前(L587)
    sb.from('group_sessions').select('id, industry')
// 変更後
    sb.from('group_sessions').select('id, industry, expires_at')
```

### 3-2. ラベル・色の追加

1. `INDUSTRY_LABELS` に追加:`event: '🎪 イベント・催事'`
2. `INDUSTRY_SHORT` に追加:`event: 'イベント'`
3. CSS に追加(既存6色の直後):

```css
  .bar-event { background: #F4A261; }
  .bar-cat-normal { background: #4A6080; }
  .bar-cat-event { background: #F4A261; }
```

4. タグ色を追加(既存 `.industry-tag.attraction` の直後):

```css
  .industry-tag.event { background: #fdf1e3; color: #a05a1c; }
```

### 3-3. 集計(19-1・19-2)

業種内訳の集計ブロック(L623-629 相当)を次のとおり変更する。

```js
  // 業種内訳(7業種対応・アクティブグループのみ集計)
  // [第19章 19-2] 期限切れの event はアクティブ扱いにしない(通常グループは従来どおり期限を見ない)
  const counts = { hotel: 0, clinic: 0, care: 0, attraction: 0, freelance: 0, club: 0, event: 0 };
  const nowTs = Date.now();
  const isExpiredEvent = (g) =>
    g.industry === 'event' && g.expires_at && new Date(g.expires_at).getTime() <= nowTs;
  (industryData || []).forEach(g => {
    if (!activeGroupIds.has(g.id)) return;
    if (isExpiredEvent(g)) return;
    if (counts[g.industry] !== undefined) counts[g.industry]++;
  });
```

(既存の forEach/if を上記に置き換える。`total` の算出行は変更不要 — counts に event が加わることで自然に含まれる)

### 3-4. 2分類サマリ(19-1)

業種内訳の HTML 生成(L637 の `const html = ...` の直前)に大分類の算出を追加し、7業種バーの**上**に大分類2行を表示する。

```js
  // [第19章 19-1] 大分類:通常グループ／イベントグループ
  const eventCount  = counts.event;
  const normalCount = Object.entries(counts)
    .filter(([k]) => k !== 'event')
    .reduce((a, [, v]) => a + v, 0);
  const catTotal = (normalCount + eventCount) || 1;
  const catHtml = `
    <div class="industry-row">
      <div class="industry-label">■ 通常グループ</div>
      <div class="bar-wrap"><div class="bar-fill bar-cat-normal" style="width:${Math.round(normalCount/catTotal*100)}%"></div></div>
      <div class="industry-count">${normalCount}</div>
    </div>
    <div class="industry-row" style="margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid var(--border, #e0e0e0);">
      <div class="industry-label">■ イベントグループ</div>
      <div class="bar-wrap"><div class="bar-fill bar-cat-event" style="width:${Math.round(eventCount/catTotal*100)}%"></div></div>
      <div class="industry-count">${eventCount}</div>
    </div>`;
```

最終行の差し込みを変更:

```js
// 変更前
  document.getElementById('industry-breakdown').innerHTML = html;
// 変更後
  document.getElementById('industry-breakdown').innerHTML = catHtml + html;
```

7業種バーの生成(`Object.entries(counts).map(...)`)自体は**変更しない**(counts に event が入ることで7本目が自然に描画される)。

## 4. 完了条件

- 変更が admin.html のみであること
- counts が7キー(event 含む)・INDUSTRY_LABELS/SHORT に event が追加されていること
- 期限切れ event の除外が業種内訳・2分類にのみ効いていること(統計カードは不変更)
- 認証・メンバー一覧・Storage・既存6業種の描画コードに差分が無いこと

## 5. 動作確認(超管理者アカウントで admin.html を開く)

| # | 確認 | 期待 |
|---|---|---|
| 1 | 業種内訳の先頭 | 「■ 通常グループ N」「■ イベントグループ M」の大分類2行が出る |
| 2 | 7本目のバー | 「🎪 イベント」が表示され、**テストイベントB が1件**として数えられる |
| 3 | 期限切れ event(7/29以降ならテストイベントA) | 業種内訳・2分類に**含まれない** |
| 4 | グループタブ | event グループの業種タグが「🎪 イベント・催事」表示になる |
| 5 | 既存6業種のバー・統計カード・メンバー一覧・Storage表示 | 変化なし |

※確認3は 7/29 のテストイベントA期限切れ後に再確認すれば十分(当日は項目1・2・4・5でマージ判断可)。
