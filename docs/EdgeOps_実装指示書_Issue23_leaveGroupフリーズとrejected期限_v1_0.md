# EdgeOps 実装指示書 Issue㉓
## A:leaveGroup() 体感フリーズ対策(isLeaving＋ローディング＋一括・並列化) ＋ B:restoreSession() rejected 経路の期限切れ event 除外

**版**:v1.0 / **作成**:2026/7/27
**根拠**:第161回チャッピー判定 条件付きGO(EO-DEC-0161)。**read_count 更新は Promise.all ではなく Promise.allSettled(チャッピー修正条件)**
**前提**:Issue⑭〜㉒ マージ済み

> **行番号は 2026/7/27 ㉒マージ後 main の実測値。行番号ではなく関数名で対象を特定すること。**

---

## 0. 絶対条件(第161回の条件そのまま)

- 既読集計ロジックそのものは変更しない。`item_receivers` / `receiver_count` / `read_receipts` の全体仕様 / `realReadMap` には触らない。**未読既読化の実行方法だけを、直列から一括・並列へ変える**
- 既読化に失敗しても退出自体は完遂する(`status='left'` 更新・主催者権限引き継ぎは継続)。失敗は console.warn に残す
- **第160回A の is_signage 昇格除外(leaveGroup の昇格クエリ・resolveIsCreator。EO-DEC-0160 コメント付き)は巻き戻さない・触れない**
- DB変更・RPC新設・Edge Function 変更は行わない
- B:通常グループは期限切れでも従来どおり復帰させる(除外は期限切れ event のみ・E10 と同一基準)

## 1. 変更対象ファイル(この1つ以外を変更しないこと)

1. `index.html` — A:leaveGroup() まわり3点、B:restoreSession() の rejected 分岐1点

**変更禁止**:`js/` 配下すべて、`signage.html`、`styles.css`、`admin.html`、`supabase/functions/` 配下すべて。キャッシュクエリの変更なし

## 2. A:leaveGroup() フリーズ対策

### 2-1. isLeaving ガード＋ローディング表示

`async function leaveGroup()`(L4177付近)の直前にモジュール変数を追加し、関数の骨格を次のとおりにする(**内部の既存処理は 2-2 以外1文字も変更しない**)。

```js
let isLeaving = false; // [EO-DEC-0161] leaveGroup 二重実行防止

async function leaveGroup() {
  if (isLeaving) return;
  if (!confirm('グループを退出しますか？')) return;
  isLeaving = true;
  // [EO-DEC-0161] 処理中表示(起動時と同じ #loading を再利用)
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'flex';
  try {
    stopPolling();
    …(既存処理そのまま)…
  } catch (e) {
    …(既存 catch そのまま)…
  } finally {
    isLeaving = false;
    hideLoading();
  }
}
```

- 既存コードに finally が無い場合は追加する。既存の try/catch 構造・catch の中身は変更しない
- `#loading` は起動画面のスピナー(`display:flex` で表示・`hideLoading()` で非表示)。文言「EdgeOps を起動中...」はそのままでよい(汎用スピナーとして再利用。文言変更はスコープ外)
- 退出成功時は画面遷移するため、finally の `hideLoading()` は成功・失敗どちらでも安全(遷移後に非表示化されるだけ)

### 2-2. 未読既読化の一括・並列化

現行の直列ループ:

```js
      const unreadMsgIds = receivedMsgIds.filter(id => !readMsgIds.has(id));
      for (const msgId of unreadMsgIds) {
        const msg = messages.find(m => m.id === msgId);
        if (!msg) continue;
        await supabase.from('read_receipts').insert({ message_id: msgId, eo_uid: currentUser.eo_uid, read_at: new Date().toISOString() });
        await supabase.from('messages').update({ read_count: (msg.read_count || 0) + 1 }).eq('id', msgId);
      }
```

を次に置き換える:

```js
      const unreadMsgIds = receivedMsgIds.filter(id => !readMsgIds.has(id));
      if (unreadMsgIds.length > 0) {
        // [EO-DEC-0161 案ア] 直列2Nリクエスト→一括INSERT＋並列UPDATE。
        //   失敗しても退出は完遂する(console.warnのみ)。既読集計ロジック自体は不変更。
        const nowIso = new Date().toISOString();
        const { error: bulkErr } = await supabase.from('read_receipts').insert(
          unreadMsgIds.map(id => ({ message_id: id, eo_uid: currentUser.eo_uid, read_at: nowIso }))
        );
        if (bulkErr) console.warn('[leaveGroup] read_receipts 一括INSERT失敗(退出は継続):', bulkErr);

        // [EO-DEC-0161 チャッピー条件] Promise.all ではなく Promise.allSettled を使う
        const updateResults = await Promise.allSettled(
          unreadMsgIds.map(id => {
            const msg = messages.find(m => m.id === id);
            if (!msg) return Promise.resolve({ error: null });
            return supabase.from('messages')
              .update({ read_count: (msg.read_count || 0) + 1 })
              .eq('id', id);
          })
        );
        updateResults.forEach((r, i) => {
          const err = r.status === 'rejected' ? r.reason : r.value?.error;
          if (err) console.warn('[leaveGroup] read_count 更新失敗(退出は継続):', unreadMsgIds[i], err);
        });
      }
```

- supabase-js は失敗を throw せず `{ error }` で返すため、この形なら既読化の失敗が外側の catch に飛ばず、後続の退出処理(status='left'・昇格引き継ぎ)がそのまま続行される
- `readMsgIds` の事前除外(既存)により重複 INSERT は原則発生しない。万一 bulkErr が出ても継続する

## 3. B:restoreSession() rejected 経路の期限切れ event 除外

`restoreSession()` 内の `member.status === 'rejected'` 分岐(L1539付近)を次のとおり変更する。

```js
// 変更前
          .order('created_at', { ascending: false }).limit(1);
        if (remainingMemberships && remainingMemberships.length > 0) {
          const next = remainingMemberships[0];
// 変更後
          .order('created_at', { ascending: false }).limit(20); // [EO-DEC-0161] 期限切れevent除外のため複数取得
        // [EO-DEC-0161 / Issue⑬ E10 と同一基準] 期限切れ event のみスキップ。
        // 通常グループは期限切れでも現行どおり復帰する
        const validMemberships = (remainingMemberships || []).filter(m => {
          const g = m.group_sessions;
          if (!g) return false;
          if (g.industry !== 'event') return true;
          return !(g.expires_at && new Date(g.expires_at) <= new Date());
        });
        if (validMemberships.length > 0) {
          const next = validMemberships[0];
```

- `next` を使う以降の処理(currentGroup 設定・localStorage・resolveIsCreator・loadHome・トースト)は**変更しない**
- 該当0件のときは既存の catch 下のフォールバック(`clearEdgeOpsLocalStorage()` → screen-start)へ自然に落ちる(既存コード不変更)

## 4. 完了条件

- 変更が index.html の A(3点)・B(1点)のみであること
- read_count 更新が **Promise.allSettled** であること(Promise.all は不可)
- 既存の EO-DEC-0160 昇格除外・退出時の status/is_creator/is_signage UPDATE・アンケート回答削除・退出後の遷移処理に差分が無いこと
- キャッシュクエリに差分が無いこと

## 5. 動作確認

| # | 手順 | 期待 |
|---|---|---|
| 1 | テストグループで未読を10件以上作る(送信側端末で連投)→ 受信側端末が既読を付けずに退出 | **数秒以内に退出完了**・処理中はスピナー表示・二重タップしても何も起きない |
| 2 | 退出後、送信側で当該メッセージの既読数 | 退出者分が既読に計上されている(分母整合・従来どおり) |
| 3 | rejected 復帰:却下されたメンバーの他所属の最新が**期限切れ event** の場合 | 期限切れ event へは復帰せず、次の有効なグループ(または screen-start)へ |
| 4 | 通常グループの退出・昇格(㉒の確認と同じ) | 変化なし |

※確認3は再現準備が重いため、コードレビューでのロジック確認＋8/1 通しテストでの確認でも可。

## 6. スコープ外(記録)

leaveGroup() 内の**退出後の自動切替**(残り所属の最新1件へ切替する処理)にも同種の limit(1) 無条件取得があるが、第161回の判定範囲は restoreSession の rejected 経路のみのため**本Issueでは触れない**。次回判定(8/1 通しテスト時)の論点候補として記録する。
