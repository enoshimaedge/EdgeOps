# EdgeOps 実装指示書 Issue C 自動切替の期限切れevent除外(2箇所) v1.0

**日付**:2026/8/1 ／ **起案**:Web Claude ／ **実装**:GitHub Copilot
**判定**:第163回(EO-DEC-0163)条件付きGO。limit(20)・除外は期限切れeventのみ・単独PR、が条件
**この指示書に完全に従うこと。指示書にない変更を行わないこと。**

---

## 0. 変更対象ファイル

| ファイル | 変更 |
|---|---|
| `index.html` | `leaveGroup()` と `cancelRequest()` の自動切替部分のみ |

**やらないこと(判定条件)**:共通化リファクタ・DB変更・RPC変更・既読3分類([EO-DEC-0162]の付いたコード)への変更・機械既読廃止の巻き戻し・`js/` 配下や他ファイルへの変更。

## 背景

期限切れeventのmembershipしか残っていない利用者が「退出」または「申請取消」をすると、期限切れイベントへ自動切替してしまう(E10「期限切れeventは復帰しない」原則と矛盾)。第161回で塞いだ restoreSession() の同型の穴。

**除外式は既存の確立パターン(`loadMyGroups()` 内の `[Issue⑬ E10]` フィルタ)と同一にする**:

```js
if (!g || g.industry !== 'event') return true;  // 通常グループは期限切れでも残す
return !(g.expires_at && new Date(g.expires_at) <= new Date());
```

## 修正1:leaveGroup() 末尾の自動切替

`remainingMemberships` を取得するクエリ(コメント「残り所属グループを取得」の箇所)を変更する:

```js
// 変更前
.select('id, group_session_id')
...
.order('created_at', { ascending: false })
.limit(1);

// 変更後
.select('id, group_session_id, group_sessions(id, industry, expires_at)')
...
.order('created_at', { ascending: false })
.limit(20); // [EO-DEC-0163] 1人20グループ上限のため取得漏れなし
```

取得後、次のフィルタを挟んで**先頭の有効な1件**へ切り替える:

```js
// [EO-DEC-0163] 期限切れeventのみ除外(E10と同一基準)。通常グループは期限切れでも残す
const validMemberships = (remainingMemberships || []).filter(mem => {
  const g = mem.group_sessions;
  if (!g || g.industry !== 'event') return true;
  return !(g.expires_at && new Date(g.expires_at) <= new Date());
});
if (validMemberships.length > 0) {
  const next = validMemberships[0];
  showToast('グループを退出しました');
  await switchGroup(next.group_session_id, next.id);
  return;
}
```

有効な1件も無ければ既存フォールバック(EdgeOpsキャッシュ消去＋screen-start)へ。**フォールバック側・catch側は変更しない。**

## 修正2:cancelRequest() の申請取消後の自動切替

同関数内の `remainingMemberships` 取得(既に `group_sessions(*)` をjoin済み)の `limit(1)` を `limit(20)` に変更し、取得後に修正1と**同じフィルタ**(`mem.group_sessions` を判定)を挟んで先頭の有効な1件へ切り替える。切替処理本体(`currentMemberId`/`currentGroup`/localStorage/`resolveIsCreator`/`loadHome`)は既存のまま、対象を `validMemberships[0]` に差し替えるのみ。

有効な1件も無ければ既存フォールバック(`clearEdgeOpsLocalStorage()`＋screen-start)へ。**変更しない。**

## 実機確認(野口さん・マージ後)

**江の島フットボールクラブ＋テストイベントで実施。社員⭐︎・フロントでは退出しない。**

| # | 操作 | 期待 |
|---|---|---|
| 1 | 通常グループ2つに所属する端末で片方を退出 | もう片方へ自動切替(従来どおり) |
| 2 | 「通常1つ＋期限切れevent」の端末で通常側を退出 | **期限切れeventへ切り替わらず** screen-start へ |
| 3 | 所属1つだけの端末で退出 | screen-start(従来どおり) |
| 4 | 申請中グループの申請取消 | 他の有効な所属へ切替、無ければ screen-start(従来どおり) |
| 5 | 通常グループ回帰 | 退出・切替以外の挙動不変 |

※確認2の「期限切れevent」が手元に無い場合は、テストイベントの expires_at を過去日時にSQLで一時変更…は**行わない**(L3領域)。7/29に期限切れとなったテストイベントAの残骸所属がある端末があればそれを使い、無ければ確認2は次の自然発生時に持ち越しでよい(コードレビューで担保)。

## 手順(野口さん)

1. タグ `pre-autoswitch-fix` を作成
2. Issue起票(本書全文を本文に貼付・**論点B等と混ぜない単独PR**=判定条件)→ Copilot PR
3. PR差分確認:**index.html のみ・leaveGroup と cancelRequest の2箇所のみ**。[EO-DEC-0162] の付いた行が差分に含まれていないこと
4. マージ→実機確認

## スコープ外

論点B(第24章・第25章)・サイネージ側の既読3分類追従(PR-B2)・清掃SQL(野口さん直接実行・本書に含めない)
