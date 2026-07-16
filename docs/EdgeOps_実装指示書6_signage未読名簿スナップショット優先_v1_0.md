# 実装指示書⑥ signage.html の未読名簿を item_receivers 優先にする（signage.html）

- 対象ファイル：`signage.html`
- 対象箇所：詳細モーダルの未読/既読名簿を生成する関数（検索目印：`詳細モーダル集計仕様` / `humanMembers` / `unreadMembers`）
- 判定：EO-DEC-0125（条件付きGO・案A）
- 前提：signage-fetch（指示書⑤）は本番反映済みで、応答に `item_receivers` が含まれる。index.html の詳細画面は既に item_receivers 優先（第124回）。
- ゴール：signage の未読名簿を、item_receivers がある連絡ではそれを正本にする。無い過去分は従来どおり。**これでスマホとサイネージの未読名簿が一致する。**
- **反映方法**：index.html と同じ。マージ → Vercel 自動反映（Supabase貼り付けは不要）。

---

## 1. 変更の考え方（第124回・第125回と同一思想）

現状、signage の未読名簿は `humanMembers`（現在の在籍メンバーから送信時点フィルタで逆算）を元にしている。これは index.html を第124回で直す前と同じ方式で、退出→再入場者がいると食い違う。

item_receivers（送信時の受信者スナップショット）があれば、それを名簿の元にする。無ければ従来どおり（参考表示）。

### 第125回の絶対条件（必ず守る）

| 項目 | 扱い |
|---|---|
| 既読数字・バッジ（receiver_count基準） | **触らない** |
| realReadMap 相当の既読集計 | **触らない** |
| signage の CSS | **触らない** |
| 認証・トークン・localStorage 復元 | **触らない** |
| ポーリング・リトライ | **触らない** |
| **未読名簿の顔ぶれ（今回の対象）** | item_receivers 優先に変更 |

---

## 2. 実装

未読/既読名簿を作っている関数の中で、`humanMembers` を算出している箇所を「message かつ item_receivers がある場合はスナップショット優先」に変える。

### 現状のコード（このブロックの直後に分岐を足す）

```js
    // 送信時点で在籍していた人間メンバー = 分母対象
    const humanMembers = (members || []).filter(m => {
      if (m.is_signage === true) return false;                            // B
      if (m.eo_uid === senderUid) return false;                           // C
      if (itemCreatedAtMs !== null) {
        const joinedAt = memberJoinedAtModal.get(m.eo_uid);
        if (joinedAt !== undefined && joinedAt > itemCreatedAtMs) return false; // D
      }
      return true;
    });
```

### 変更後（上記の `humanMembers` 定義の直後に、下記を追加する）

`const humanMembers = ...` の定義はそのまま残し、その**直後**に次を追加する：

```js
    // ════════════════════════════════════════════════════════════
    // [受信者スナップショット優先 / EO-DEC-0125 / 2026-07-16]
    // 連絡(message)で item_receivers があれば、それを未読名簿の正本にする。
    // → スマホ詳細画面(第124回)と同じ顔ぶれになり、端末間の食い違いを解消。
    // 無い過去分は従来の humanMembers（参考表示）のまま。
    // 対象は未読/既読名簿の「顔ぶれ」のみ。既読数字・バッジには影響しない。
    // ════════════════════════════════════════════════════════════
    let rosterMembers = humanMembers;
    if (itemType === 'message') {
      const allItemReceivers = _globalSignageData ? (_globalSignageData.item_receivers || []) : [];
      const snapshotRows = allItemReceivers.filter(ir => ir.item_id === itemId);
      if (snapshotRows.length > 0) {
        const snapshotUids = new Set(snapshotRows.map(ir => ir.receiver_eo_uid));
        rosterMembers = (members || []).filter(m => snapshotUids.has(m.eo_uid));
      }
    }
```

### そして、名簿生成を `humanMembers` から `rosterMembers` に差し替える

現状：

```js
    const readMembers = humanMembers.filter(m => readUids.includes(m.eo_uid));
    const unreadMembers = humanMembers.filter(m => !readUids.includes(m.eo_uid));
```

変更後：

```js
    const readMembers = rosterMembers.filter(m => readUids.includes(m.eo_uid));
    const unreadMembers = rosterMembers.filter(m => !readUids.includes(m.eo_uid));
```

---

## 3. 注意点（必ず守る）

1. **`humanMembers` の定義自体は消さない・変えない。** 過去分（item_receivers 無し）は従来どおり `humanMembers` を使う（`rosterMembers = humanMembers` が初期値）。
2. **既読数字・バッジ（buildItemHtml の receiver_count 基準の集計・「N/M人既読」表示）には一切触らない。** 今回変えるのは詳細モーダルの名簿の「顔ぶれ」だけ。
3. **`readUids` の算出ロジックは変更しない。** 既読者の判定は従来どおり。
4. **item_receivers にサイネージ・送信者は元々含まれない**（signage-fetch/RPC側で除外済み）。そのため `rosterMembers = members.filter(m => snapshotUids.has(m.eo_uid))` は自動的にそれらを含まない。
5. **handover（引き継ぎ）は対象外。** `itemType === 'message'` のときだけスナップショットを使う。handover は従来どおり `humanMembers`。
6. **CSS・認証・ポーリング・localStorage には触らない。**
7. **`_globalSignageData.item_receivers` が undefined でも安全に動くこと**（`|| []` でガード済み）。signage-fetch が古い場合でも従来動作にフォールバックする。

---

## 4. 動作確認（本番反映後）

### 4-1 端末間の一致（本丸）

- item_receivers 導入後に送った連絡を、**スマホの詳細画面**と**サイネージの詳細モーダル**の両方で開く
- 未読名簿の顔ぶれが**一致**すること

### 4-2 退出→再入場のケース

- フロント2グループ（再入場者「二郎」）で、二郎が退出中に送られた連絡について
  - スマホ・サイネージとも、二郎が未読名簿に**出ない**こと

### 4-3 過去分（スナップショットなし）

- 古い連絡をサイネージで開き、従来どおりの表示になること（デグレなし）

### 4-4 既読数字（変えていないこと）

- サイネージの既読バッジ（「N/M人既読」）が変更前と同じであること

---

## 5. この指示書の対象外

- signage-fetch（指示書⑤で対応済み・本番反映済み）
- 既読数字・realReadMap・CSS・認証・ポーリング → 触らない（第125回絶対条件）
- index.html（第124回で対応済み）
