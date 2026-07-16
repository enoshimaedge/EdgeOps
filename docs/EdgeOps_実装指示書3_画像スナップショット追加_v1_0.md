# 実装指示書③ 画像投稿に受信者スナップショットを追加（upload-image Edge Function）

- 対象ファイル：Edge Function `upload-image` の `src/index.ts`
- 判定：EO-DEC-0124（条件付きGO）
- 前提：DB側は完了済み。`item_receivers` テーブルは作成済み。指示書①（通常連絡）②（引き継ぎ）は本番反映・実機確認済み。
- ゴール：画像付き**連絡**の投稿時に、受信者スナップショットを `item_receivers`（item_type='message'）へ保存する。
- **重要な違い**：これまでの①②は index.html（フロント）だったが、③は Edge Function（サーバ側）の修正。渡す対象ファイルが違う。

---

## 1. 変更の全体像

画像投稿は Edge Function `upload-image` が処理する。この関数は既に、
- 受信者を `rcMembers` 配列として取得済み（`context === 'message'` のとき）
- 本体（messages）を INSERT し、その id を `insertedData.id` として取得済み（`.select('id').single()`）

そのため、**INSERT成功の直後に、`rcMembers` から `item_receivers` へINSERTを1つ足すだけ**でよい。新しい受信者計算は不要。

**この経路が3経路中もっとも軽い。** 配列も id も既に手元にある。

---

## 2. 追加するコード

`insertedData` を取得した直後（INSERTエラーチェックを抜けた後）、「Step 9: 成功ログ」の**前**に、下記を追加する。

### 追加位置

```
    const { data: insertedData, error: insertError } = await supabase
      .from(tableName)
      .insert(insertData)
      .select('id')
      .single();

    if (insertError || !insertedData) {
      ... （既存のエラー処理・変更しない） ...
    }

    // ★ ここに下記を追加 ★

    // ===== Step 9: 成功ログ =====   ← この既存行の直前
```

### 追加するコード本体

```ts
    // ===== 受信者スナップショット（連絡のみ・EO-DEC-0124）=====
    // context==='message' かつ rcMembers 取得成功時のみ保存する。
    // handover は対象外。rcMembers の filter 条件は receiver_count 算出と同一。
    if (metadata.context === 'message' && Array.isArray(rcMembers)) {
      const receiverRows = rcMembers
        .filter((m) => m.eo_uid !== eoUid && m.is_signage !== true)
        .map((m) => ({
          item_type: 'message',
          item_id: insertedData.id,
          group_session_id: groupSessionId,
          receiver_eo_uid: m.eo_uid,
        }));
      if (receiverRows.length > 0) {
        const { error: irError } = await supabase
          .from('item_receivers')
          .insert(receiverRows);
        if (irError) {
          // スナップショット保存失敗は投稿自体を失敗させない（本体は既に保存済み）。
          // ログのみ残し、後追い調査対象とする。
          console.error('item_receivers insert failed (image message):', {
            eoUid, groupSessionId, messageId: insertedData.id, irError,
          });
        }
      }
    }
```

---

## 3. 注意点（必ず守る）

1. **handover 分岐（`context === 'handover'`）は対象外。** `if (metadata.context === 'message' ...)` の条件で連絡のみに限定しているので、この条件を外さない。
2. **本体INSERTのエラー処理（`if (insertError || !insertedData)`）は変更しない。** そのブロックはそのまま残す。
3. **rcMembers の filter 条件は既存の receiver_count 算出と同一**（`eo_uid !== eoUid && is_signage !== true`）にする。ズレると snapshot_count と receiver_count が食い違う。
4. **スナップショット保存失敗時に投稿を失敗させない。** 本体（messages）は既に保存済みなので、item_receivers のINSERTが失敗しても `errorResponse` を返さず、`console.error` でログを残すだけにする。（本体成功後にレスポンスを失敗にすると、ユーザーは「送れなかった」と誤解して再送し二重投稿になるため。）
5. **Storage ロールバック処理・成功ログ・成功レスポンスは変更しない。**

---

## 4. デプロイについて（重要・①②と違う点）

Edge Function は Vercel ではなく **Supabase 側にデプロイ**される。index.html のように「mainにマージ→Vercel自動反映」では本番に反映されない。

Copilot の PR をマージした後、Edge Function を Supabase へデプロイする必要がある。デプロイ方法（Supabase CLI での `supabase functions deploy upload-image` など）は、既存の upload-image のデプロイ手順に従う。**この指示書の対象外**だが、実装後に必ずデプロイが必要なことを認識しておくこと。

---

## 5. 動作確認（デプロイ後）

- 画像付きの**連絡**を1件送信し、正常に投稿されること
- 画像付きの**引き継ぎ**を1件送信し、正常に投稿されること（handoverは item_receivers に入らないが、投稿は成功すること）
- Supabase で確認：

```sql
-- 直近の画像連絡と、その受信者スナップショットを確認
SELECT m.id, m.receiver_count,
       (SELECT count(*) FROM item_receivers ir
        WHERE ir.item_type='message' AND ir.item_id=m.id) AS snapshot_count
FROM messages m
WHERE m.image_url IS NOT NULL
ORDER BY m.created_at DESC LIMIT 3;
```

一番上（今送った画像連絡）の `receiver_count` と `snapshot_count` が一致していれば正常。

---

## 6. この指示書の対象外（別指示書で扱う）

- 通常連絡の送信 → 指示書①（完了済み）
- 引き継ぎの送信 → 指示書②（完了済み）
- 読み取り側（名簿を item_receivers 優先に）→ 指示書④
