# EdgeOps 実装指示書 ── プロフィール編集フォームのグループ取り違え hotfix

## 準拠判定
第131回（EO-DEC-0131）・条件付きGO・案A＋案B併用

## 対象ファイル
`index.html`（ST版本番・3,892行）のみ。**他ファイルは触らない。**

## 目的
複数グループの管理者が、プロフィール画面の編集項目（グループ名・業種・LINK URL）を、意図しない別グループへ上書きしてしまう不具合を修正する。原因は、プロフィール入力欄のDOM値がグループ切替に追従せず前グループのまま残る一方、保存は実行時の `currentGroup.id` に書き込むため、両者がズレたまま保存されること。

---

## 厳守事項（不可触）

- **表示名（display_name）経路は触らない。** `updateDisplayName()`（L3368付近・`profile-new-name` → `currentMemberId`）は現状維持。これは切替に追従するため安全。
- **RPC化しない。** 既存のフロント直UPDATEを維持し、そこに再同期とガードを足すのみ。
- **L3保護領域**（`group_sessions`/`group_members`/`messages`）のスキーマ・既存RPC・`realReadMap`・既読集計・`signage.html` は不触。
- **`switchGroup()` の既存の状態更新**（`currentGroup`/`currentMemberId`/`currentUser` 再生成・Step5初期化）は変更しない。入力欄再セット呼び出しを**追加するのみ**。
- **通常グループ（実顧客・スマイルホテル様）の本番利用に影響を出さないことを最優先。** 挙動が変わるのはプロフィール編集フォームの再同期とガードのみ。

---

## 案A：フォーム再セット関数の新設と呼び出し

### A-1. 新設関数 `syncProfileForm()`

プロフィール編集フォームの3項目のDOM値を、現在の `currentGroup` の値へ同期する関数を新設する。**対象は下記3項目のみ。** 表示名など他の項目は含めない。

```js
// プロフィール編集フォーム(3項目)を currentGroup の値へ再同期する。
// 対象: グループ名 / 業種 / LINK URL のみ。表示名は対象外(切替追従済みのため)。
function syncProfileForm() {
  const gnEl = document.getElementById('profile-group-name');
  if (gnEl) gnEl.value = currentGroup?.group_name || '';
  const indEl = document.getElementById('profile-industry');
  if (indEl) indEl.value = currentGroup?.industry || '';
  const linkEl = document.getElementById('profile-link-url');
  if (linkEl) linkEl.value = (currentGroup && typeof currentGroup.link_url === 'string') ? currentGroup.link_url : '';
  // 案B用: このフォームがどのグループを表示しているかを記録
  profileFormGroupId = currentGroup?.id || null;
}
```

### A-2. `showProfile()` 内の既存セット処理を関数呼び出しへ置換

`showProfile()`（L3381付近）内の、以下の既存3ブロック（現行 L3401-3408 相当）を削除し、`syncProfileForm()` の呼び出し1行に置き換える。**現行と同じ位置**（管理者セクション表示切替の直後、業種セット・LINKセットの並び）に置く。

- 削除対象：`profile-group-name` への `gnEl.value = ...`
- 削除対象：`profile-industry` への `indEl.value = ...`
- 削除対象：`profile-link-url` への `linkEl.value = ...`
- 追加：`syncProfileForm();`

### A-3. `currentGroup` が切替・復元される経路で `syncProfileForm()` を呼ぶ

以下の経路で、`currentGroup` の更新が完了した**直後**に `syncProfileForm()` を呼ぶ。プロフィール画面が現在表示されているか否かに関わらず呼んでよい（DOM値を先に正しくしておく）。

1. **`switchGroup()`**（L3761付近）：`currentGroup = newGroup;`（L3793）以降、関数末尾の `loadHome()` 前後のいずれか。既存の状態更新・Step5初期化は変更せず、`syncProfileForm();` を1行追加する。
2. **`restoreSession()`**（L1405付近）：`currentGroup = ...` で確定する箇所（L1435 / L1464）の後。
3. **`restoreExistingMembershipIfAny()`**（L1531付近）：`currentGroup = m.group_sessions;`（L1551）の後。

> 補足1：`syncProfileForm()` は、**必ず `currentGroup` の代入が完了した後に呼び出すこと。`currentGroup` 更新前には呼ばない。** 更新前に呼ぶと、前グループの値でフォームと `profileFormGroupId` を埋めてしまい、ガードが正しく機能しなくなる。
>
> 補足2：`currentGroup` 代入箇所は他にもある（L1659/L1763/L1808/L1837 等）。上記3経路を優先実装とし、残りは案B（保存直前ガード）が最後の砦となる前提で、PR差分レビュー時に必要性を判断する。過剰な挿入は避ける。

---

## 案B：保存直前ガード

### B-1. モジュールスコープ変数の追加

`let currentGroup = null;`（L1201付近）の近くに、フォームが表示中のグループIDを保持する変数を追加する。

```js
let profileFormGroupId = null; // プロフィール編集フォームが表示しているグループの id
```

（この変数は A-1 の `syncProfileForm()` 末尾でセットされる。）

### B-2. 4つの保存関数の冒頭にガードを追加

以下の4関数の冒頭（既存の入力チェックの前後どちらでもよいが、DB更新より前）に、表示中グループと現在グループの一致確認を入れる。不一致なら保存せず中断し、再同期する。

対象関数：
- `updateGroupName()`（L3217付近）
- `updateIndustry()`（L3236付近）
- `updateLinkUrl()`（L3285付近）
- `removeLinkUrl()`（L3308付近）

追加するガード（共通）：

```js
if (profileFormGroupId && currentGroup?.id && profileFormGroupId !== currentGroup.id) {
  showToast('グループ情報が切り替わりました。画面を更新してからもう一度お試しください。');
  syncProfileForm(); // 現在グループの値へ再同期
  return;
}
```

> 補足：ガード処理を共通関数化する場合でも、**対象は `updateGroupName` / `updateIndustry` / `updateLinkUrl` / `removeLinkUrl` の4関数のガードに限定する。** 保存処理本体・表示名 `updateDisplayName`・`switchGroup` の既存状態更新・DB更新先（`.update({...}).eq('id', currentGroup.id)` の書き込み内容）は変更しないこと。重複コードを嫌って周辺を大きくリファクタしないこと。

---

## 受け入れ条件（テスト）

実機（LIFF）で、フロント2 ⇄ 江の島フットボールクラブ（両方管理者の一郎）を用いて確認する。

| # | テスト | 期待結果 |
|---|---|---|
| 1 | Aグループのプロフィールを開いたままBグループへ切替 | フォーム値がBグループの値に更新される |
| 2 | Aのフォーム値が残った状態を意図的に作りBで保存 | ガードで保存中断・トースト表示・再同期される |
| 3 | グループ名・業種・LINK URL の3項目を各グループで保存 | すべて対象グループだけが更新される |
| 4 | LINK URL 削除 | 別グループのLINKを削除しない |
| 5 | リロード後にプロフィール復元 | 現在グループの値が表示される |
| 6 | 表示名変更 | 既存どおり正常（今回の変更の影響を受けない） |
| 7 | 通常グループ（実顧客・スマイルホテル様）の通常操作 | 影響なし |

---

## リリース手順（野口）

1. **切り戻し用タグを打つ**：本番反映前に `pre-fix-profile-guard` を現行 main の commit に付与。
2. Copilot が上記に沿ってPRを作成 → 差分確認（案Aの挿入点・案Bのガード4箇所・表示名非変更・他ファイル非変更）。
3. `ds-step34` 等の進行中ブランチと混ぜない。**独立したhotfix**として扱う。
4. マージ → Vercel自動反映 → 実機で受け入れ条件1〜7を確認。
5. 確認後、`fix-profile-guard` タグを付与。

---

## 参考：確定事実（実コード行番号・index.html 3,892行時点）

- 取り違えの起点：`updateGroupName` L3223-3224（値＝入力欄、対象＝`currentGroup.id`）
- 入力欄セットは `showProfile` L3401-3408 のみ・切替非追従
- `switchGroup` L3761-3820 末尾は `loadHome()`（`showProfile()` 非呼び出し）・`currentGroup=newGroup` は L3793
- 同型の危険：業種 L3239-3240／LINK URL L3285-3286・L3315-3316
- 安全（除外）：表示名 `updateDisplayName` L3368-・`eq('id', currentMemberId)` L3373
- 復元経路：`restoreSession` L1405（`currentGroup` L1435/L1464）／`restoreExistingMembershipIfAny` L1531（`currentGroup` L1551）
