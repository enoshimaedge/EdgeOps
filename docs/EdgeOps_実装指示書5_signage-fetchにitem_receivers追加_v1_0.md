# 実装指示書⑤ signage-fetch に item_receivers 取得を追加（Edge Function）

- 対象ファイル：Edge Function `signage-fetch` の `index.ts`
- 判定：EO-DEC-0125（条件付きGO・案A）
- 前提：item_receivers テーブルは作成済み。書込3経路（連絡・引き継ぎ・画像）は本番稼働中。index.html の詳細画面は既に item_receivers 優先（第124回）。
- ゴール：signage の応答（`_globalSignageData`）に item_receivers を含める。signage.html 側（指示書⑥）が未読名簿を item_receivers 優先にするための準備。
- **反映方法**：upload-image と同じ。マージ後、Supabase の画面にコードを貼って Deploy（自動デプロイではない）。

---

## 1. 変更の全体像

signage-fetch は既に、対象 messages の id 配列 `msgIds` を作り、read_receipts を `.in('message_id', msgIds)` で取得している。これと**まったく同じパターン**で、item_receivers を `item_type='message'` かつ `item_id IN (msgIds)` で取得し、応答に追加する。

**第125回の必須条件：** item_receivers は全件取得しない。**signage-fetch が返す対象 messages の id（= msgIds）に限定**して取得する。これにより payload 肥大を防ぐ。

---

## 2. 変更点は3箇所（すべて「追加」・既存行は変更しない）

### 変更① 並列取得に item_receivers を追加

`Promise.allSettled([...])` の配列（read_receipts などを取得しているブロック）に、item_receivers の取得を1つ追加する。

**追加する要素**（配列の末尾、surveyResponses の取得の後に足す）：

```ts
    msgIds.length > 0
      ? supabase.from('item_receivers')
          .select('item_id, receiver_eo_uid')
          .eq('item_type', 'message')
          .in('item_id', msgIds)
      : Promise.resolve({ data: [], error: null }),
```

分割代入の受け取り側にも変数を追加する：

```ts
  const [
    receiptsResult,
    confirmationsResult,
    membersResult,
    allMembersHistResult,
    surveyResponsesResult,
    itemReceiversResult,   // ← 追加
  ] = await Promise.allSettled([
    // ... 既存 ...
    // ↑ 末尾に上記 item_receivers 取得を追加
  ]);
```

### 変更② 取得結果の取り出しを追加

既存の `const surveyResponses = ...` の直後に、同じパターンで追加：

```ts
  const itemReceivers = (itemReceiversResult.status === 'fulfilled' && !itemReceiversResult.value.error)
    ? (itemReceiversResult.value.data || []) : [];
```

必要なら logPartialFailure も既存にならって1行追加してよい（任意）：

```ts
  logPartialFailure(rid, 'item_receivers_fetch', itemReceiversResult);
```

### 変更③ 応答（jsonResponse）に item_receivers を追加

`return jsonResponse({ ... }, 200);` のオブジェクトに1行追加：

```ts
  return jsonResponse({
    ok: true,
    rid,
    group: safeGroup,
    messages,
    handover_notes: handoverNotes,
    read_receipts: receipts,
    handover_confirmations: confirmations,
    members,
    all_members_hist: allMembersHist,
    survey_responses: surveyResponses,
    item_receivers: itemReceivers,   // ← 追加
  }, 200);
```

---

## 3. 注意点（必ず守る・第125回の絶対条件）

1. **既存の取得（messages / handover_notes / read_receipts / members / all_members_hist / survey_responses）は一切変更しない。** item_receivers を「追加」するだけ。
2. **item_receivers は全件取得しない。** 必ず `.eq('item_type','message').in('item_id', msgIds)` で対象メッセージに限定する（payload肥大防止・第125回条件）。
3. **msgIds が空のときは取得しない**（`msgIds.length > 0 ? ... : Promise.resolve({data:[],error:null})`）。他の取得と同じガードにする。
4. **認証・トークン照合・group_sessions 照合・エラー処理・CORS は触らない。**
5. **safeGroup（signage_token/signage_enabled 除外）のロジックは触らない。**
6 応答のキー名は **`item_receivers`**（snake_case）にする。signage.html 側（指示書⑥）がこのキーで読む。

---

## 4. 動作確認（デプロイ後）

- signage-fetch を呼び出す（サイネージ画面を開く、またはTest実行）
- 応答JSONに `item_receivers` 配列が含まれること
- 各要素が `{ item_id, receiver_eo_uid }` を持つこと
- 対象 messages に紐づく行だけが返り、全件ではないこと

確認SQL（参考・item_receivers が対象messagesに存在するか）：

```sql
SELECT ir.item_id, count(*) AS receivers
FROM item_receivers ir
WHERE ir.item_type = 'message'
GROUP BY ir.item_id
ORDER BY ir.item_id
LIMIT 10;
```

---

## 5. この指示書の対象外（別指示書で扱う）

- signage.html の未読名簿ロジック変更 → 指示書⑥
- 既読数字・バッジ・realReadMap → 触らない（第125回絶対条件）
- index.html（既に第124回で対応済み）
