# 実装指示書④ 詳細画面の未読名簿を item_receivers 優先にする（index.html）

- 対象ファイル：`index.html`
- 対象関数：`showDetail(messageId)`（連絡の詳細画面）
- 判定：EO-DEC-0124（条件付きGO）
- 前提：書込3経路（①連絡・②引き継ぎ・③画像）は本番反映・実機確認済み。新しい投稿には item_receivers が正しく保存されている。
- ゴール：詳細画面の**未読名簿**を、スナップショット（item_receivers）がある投稿ではそれを正本にする。無い過去分は従来どおり（現在メンバー由来の参考表示）。

---

## 1. 変更の考え方（重要・慎重に）

現状、詳細画面は「数字」と「名前リスト」を別ソースで作っているため、退出→再入場者がいると食い違う。

- 数字（totalMembers）＝ `msg.receiver_count`（送信時に固定）
- 名前リスト（unreadMembers）＝ 現在メンバー `members` から送信時点フィルタで逆算 ← ここがズレる

今回、**名前リストの元になる `receivers` を、item_receivers があればそこから作る**ように変える。

### 変えるもの / 変えないもの

| 項目 | 扱い |
|---|---|
| `totalMembers`（合計の数字） | **変えない**。従来どおり `msg.receiver_count` |
| `readCount`（既読の数字） | **変えない** |
| 既読リスト（detail-read-list） | **変えない**。read_receipts 由来のまま |
| `receivers`（受信者リスト＝未読名簿の元） | **変える**。item_receivers があればそこから作る |
| `unreadMembers` | `receivers` から派生するので自動的に正しくなる |

**過去分（item_receivers が無い投稿）は、従来の `receivers` 算出をそのまま使う**（参考表示）。これにより過去分の挙動は一切変わらない。

---

## 2. 実装

`showDetail()` 内の `receivers` を算出している箇所（検索目印：`未読リスト分母仕様`）を、下記のように「スナップショット優先」に変える。

### 現状のコード（このブロックを置き換える）

```js
  const receivers = members.filter(m => {
    if (m.eo_uid === msg.sender_eo_uid) return false;                          // C
    if (m.is_signage) return false;                                            // B
    const joinedAt = detailMemberJoinedAt.get(m.eo_uid);
    if (joinedAt !== undefined && joinedAt > msgCreatedAtMs) return false;     // D
    return true;
  });
```

### 変更後のコード

```js
  // ════════════════════════════════════════════════════════════
  // [受信者スナップショット優先 / EO-DEC-0124 / 2026-07-16]
  // item_receivers があればそれを未読名簿の正本にする（送信時の顔ぶれで固定）。
  // 無い過去分は従来どおり現在メンバーから逆算（参考表示）。
  // 数字(totalMembers=receiver_count)・既読リストは変更しない。
  // ════════════════════════════════════════════════════════════
  let receivers;
  const { data: snapshotRows } = await supabase.from('item_receivers')
    .select('receiver_eo_uid')
    .eq('item_type', 'message')
    .eq('item_id', messageId);

  if (Array.isArray(snapshotRows) && snapshotRows.length > 0) {
    // スナップショットあり：送信時の顔ぶれを正本にする
    const snapshotUids = new Set(snapshotRows.map(r => r.receiver_eo_uid));
    receivers = members.filter(m => snapshotUids.has(m.eo_uid));
  } else {
    // スナップショットなし（過去分）：従来どおり現在メンバーから逆算（参考表示）
    receivers = members.filter(m => {
      if (m.eo_uid === msg.sender_eo_uid) return false;                        // C
      if (m.is_signage) return false;                                          // B
      const joinedAt = detailMemberJoinedAt.get(m.eo_uid);
      if (joinedAt !== undefined && joinedAt > msgCreatedAtMs) return false;   // D
      return true;
    });
  }
```

---

## 3. 注意点（必ず守る）

1. **`totalMembers` の行は変更しない。** `const totalMembers = msg.receiver_count != null ? msg.receiver_count : receivers.length;` はそのまま残す。数字は従来どおり receiver_count が正。
2. **既読リスト（detail-read-list）の描画は変更しない。** receiverReads / readListEl まわりは触らない。
3. **`unreadMembers` の行は変更しない。** `const unreadMembers = receivers.filter(m => !readUids.has(m.eo_uid));` はそのまま。`receivers` の中身が変わるだけで自動的に正しくなる。
4. **スナップショットの名簿には、送信者・サイネージは元々含まれない**（RPC/Edge Function側で除外済み）。そのため `receivers = members.filter(m => snapshotUids.has(m.eo_uid))` は、送信者・サイネージを自動的に含まない。二重に除外条件を足す必要はない。
5. **`members` に居ないスナップショット受信者（退出して現在メンバーにいない人）は自動的に名簿から落ちる**（`members.filter` のため）。これは意図どおり（退出した人の名前を無理に出さない）。
6. **引き継ぎ詳細（showHandoverDetail）は今回対象外。** 連絡の `showDetail` のみ変更する。（引き継ぎ詳細も同様の対応が必要なら別途。まず連絡で検証する。）
7. **signage.html は触らない。**

---

## 4. 動作確認（実装後・本番反映後）

### 4-1 新しい投稿（スナップショットあり）

- 新しく連絡を送り、詳細画面を開く
- 数字（既読・未読・合計）と、未読名簿の人数・顔ぶれが整合していること

### 4-2 退出→再入場のケース（本丸）

- フロント2グループ（再入場者「二郎」がいる）で、**再入場前に送られた古い連絡**の詳細を開く
  - 過去分（snapshot無し）なので従来どおりの参考表示。挙動は変わらない
- **item_receivers 導入後に送った連絡**の詳細を開く
  - 二郎が退出中に送った連絡なら、二郎は名簿に出ない（スナップショットに含まれないため）
  - 数字と名簿が食い違わないこと

### 4-3 過去分（スナップショットなし）

- 古い連絡の詳細を開き、従来と同じ表示になること（デグレしていないこと）

---

## 5. この指示書の対象外

- 一覧画面の既読バッジ → 一覧は receiver_count 基準の数字のみで名簿を出さないため、今回の食い違いは起きない。変更不要。
- signage.html → 触らない。
- 引き継ぎ詳細（showHandoverDetail）→ 今回は連絡のみ。必要なら別指示書。
