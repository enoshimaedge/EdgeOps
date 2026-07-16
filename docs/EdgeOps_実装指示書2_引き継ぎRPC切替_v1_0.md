# 実装指示書② 引き継ぎの送信をRPCへ切替（index.html）

- 対象ファイル：`index.html`
- 対象関数：`sendMessage()` の「引き継ぎ」分岐（`selectedComposeType === 'handover'` のブロック）
- 判定：EO-DEC-0124（条件付きGO）
- 前提：DB側は完了済み。新設RPC `create_handover_with_receivers` は作成済み。指示書①（通常連絡）は本番反映・実機確認済み。
- ゴール：`handover_notes` への直INSERTをやめ、新設RPC呼び出しに差し替える。受信者スナップショットはRPC内部で保存される。

---

## 1. 変更の全体像

現在フロントは、引き継ぎ送信時に `handover_notes` テーブルへ直接INSERTしている。これを、新設RPC `create_handover_with_receivers` の呼び出しに置き換える。`sender_name`（display_name）の取得と `item_receivers` への保存は、RPCがサーバ側で行う。

---

## 2. 置き換えるコード

`sendMessage()` の引き継ぎ分岐（`if (selectedComposeType === 'handover') {` の中）にある insert を差し替える。

### 変更前（現状）

```js
      const { error } = await supabase.from('handover_notes').insert({
        group_session_id: currentGroup.id,
        sender_eo_uid: currentUser.eo_uid,
        sender_name: currentUser.display_name,
        content: body,
        priority: selectedHandoverPriority
      });
      if (error) throw error;
```

### 変更後

```js
      const { data: rpcResult, error } = await supabase.rpc('create_handover_with_receivers', {
        p_group_session_id: currentGroup.id,
        p_body: body,
        p_priority: selectedHandoverPriority
      });
      if (error) throw error;
```

---

## 3. 注意点（必ず守る）

1. **通常連絡分岐・画像分岐は触らない。** この指示書は引き継ぎ分岐（`selectedComposeType === 'handover'`）のみが対象。
2. **RPCには本文（body）と優先度（selectedHandoverPriority）だけを渡す。** `sender_eo_uid`・`sender_name` はRPCがサーバ側で取得するため、フロントから渡さない（渡さなくてよい）。
3. **送信後の処理（compose-body クリア、selectedComposeType = 'msg'、loadMessages、showScreen、showToast「引き継ぎを投稿しました！」）は一切変更しない。** 変えるのは「INSERT」を「RPC呼び出し」にする部分だけ。
4. **try/catch・__loading（startDelayedLoading）の構造はそのまま残す。**

---

## 4. 動作確認（実装後）

- 引き継ぎを1件送信し、正常に投稿されること（トーストに「引き継ぎを投稿しました！」が出る）
- Supabase で `handover_notes` に新規行ができ、同時に `item_receivers`（item_type='handover'）に受信者分の行ができていること（下記SQLで確認）

```sql
-- 直近の引き継ぎと、その受信者スナップショットを確認
SELECT h.id,
       (SELECT count(*) FROM item_receivers ir
        WHERE ir.item_type='handover' AND ir.item_id=h.id) AS snapshot_count
FROM handover_notes h
ORDER BY h.created_at DESC LIMIT 3;
```

一番上（今送った引き継ぎ）の snapshot_count が、送信者・サイネージを除いた受信者数と一致していれば正常。

（注：handover_notes には receiver_count 列が無いため、①のような receiver_count との突き合わせはできない。snapshot_count が「送信者以外の承認済み非サイネージ人数」と一致するかを目視確認する。）

---

## 5. この指示書の対象外（別指示書で扱う）

- 通常連絡の送信 → 指示書①（完了済み）
- 画像の送信（upload-image）→ 指示書③
- 読み取り側（名簿を item_receivers 優先に）→ 指示書④
