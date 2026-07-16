# 実装指示書① 通常連絡の送信をRPCへ切替（index.html）

- 対象ファイル：`index.html`
- 対象関数：`sendMessage()` の「通常連絡」分岐（handover分岐・画像分岐ではない）
- 判定：EO-DEC-0124（条件付きGO）
- 前提：DB側は完了済み。新設RPC `create_message_with_receivers` は作成済み。
- ゴール：`messages` への直INSERTをやめ、新設RPC呼び出しに差し替える。受信者スナップショットはRPC内部で保存されるため、フロントでの受信者算出は不要になる。

---

## 1. 変更の全体像

現在フロントは、送信時に受信者数を自分で計算し（`receiverCountAtSend`）、`messages` テーブルへ直接INSERTしている。これを、新設RPC `create_message_with_receivers` の呼び出し1つに置き換える。受信者数の計算と `item_receivers` への保存は、RPCがサーバ側で行う。

---

## 2. 削除するコード

`sendMessage()` の通常連絡分岐にある、受信者数の計算ブロックを削除する。

削除対象（検索目印：`receiverCountAtSend`）：

```js
    const receiverCountAtSend = members.filter(m =>
      m.status === 'approved' &&
      m.eo_uid !== currentUser.eo_uid &&
      !m.is_signage
    ).length;
```

---

## 3. 置き換えるコード

下記の `insertPayload` 組み立て〜`insert` 実行までのブロックを、RPC呼び出しに差し替える。

### 変更前（現状）

```js
    const insertPayload = {
      group_session_id: currentGroup.id, sender_eo_uid: currentUser.eo_uid,
      body: body, read_count: 0, priority: selectedPriority,
      receiver_count: receiverCountAtSend
    };
    if (isSurvey) {
      insertPayload.is_survey = true;
      insertPayload.survey_deadline = surveyDeadline;
    }
    const { error } = await supabase.from('messages').insert(insertPayload);
    if (error) throw error;
```

### 変更後

```js
    const { data: rpcResult, error } = await supabase.rpc('create_message_with_receivers', {
      p_group_session_id: currentGroup.id,
      p_body: body,
      p_priority: selectedPriority,
      p_is_survey: isSurvey,
      p_survey_deadline: surveyDeadline
    });
    if (error) throw error;
```

---

## 4. 注意点（必ず守る）

1. **handover分岐・画像分岐は触らない。** この指示書は通常連絡分岐のみが対象。
2. **`isSurvey` / `surveyDeadline` の組み立てロジックは残す。** RPCの引数 `p_is_survey` / `p_survey_deadline` に渡すため、これらを算出している既存コード（`survey-checkbox` 判定、`surveyDeadline` の日付組み立て）はそのまま使う。
3. **送信後のUIリセット処理（compose-body クリア、selectPriority('info')、アンケートUIリセット、loadMessages、showScreen、showToast）は一切変更しない。** 変えるのは「INSERT」を「RPC呼び出し」にする部分だけ。
4. **`receiverCountAtSend` を参照している箇所が他に無いことを確認してから削除する。** 通常連絡分岐内でのみ使われているはず。

---

## 5. 動作確認（実装後）

- 通常連絡を1件送信し、正常に投稿されること
- アンケート付き連絡を1件送信し、締切が正しく保存されること
- Supabase で `messages` に新規行ができ、同時に `item_receivers` に受信者分の行ができていること（下記SQLで確認）

```sql
-- 直近の連絡と、その受信者スナップショットを確認
SELECT m.id, m.receiver_count,
       (SELECT count(*) FROM item_receivers ir
        WHERE ir.item_type='message' AND ir.item_id=m.id) AS snapshot_count
FROM messages m
ORDER BY m.created_at DESC LIMIT 3;
```

`receiver_count` と `snapshot_count` が一致していれば正常。

---

## 6. この指示書の対象外（別指示書で扱う）

- 引き継ぎの送信 → 指示書②
- 画像の送信（upload-image）→ 指示書③
- 読み取り側（名簿を item_receivers 優先に）→ 指示書④
