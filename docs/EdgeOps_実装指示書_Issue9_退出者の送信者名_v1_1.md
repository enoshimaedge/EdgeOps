# EdgeOps 実装指示書 ── Issue⑨：退出者の送信者名を解決する（スマートフォン側）

**版数**：v1.1
**作成**：2026年7月24日（金）／ Claude（設計・起案）
**根拠**：EO-DEC-0152（第152回・条件付きGO／A案＋ア案）＋ 本指示書に対する追加条件（残留防止）
**宛先**：GitHub Copilot（PR実装）

---

## 0. この指示書の使い方

**本書だけを読んで実装できるように書いてある。** 第1章（変更対象ファイル）と第2章（変更禁止領域）を先に読むこと。

**本件は「送信者名の解決」のみを目的とする。既読・未読の集計には一切影響させてはならない。** これは第152回判定の最重要条件である。

**サイネージ側（`signage-fetch`）は本PRに含めない。** 第152回判定により別PR（Issue⑩）とする。

**v1.1 の変更点**：判定の追加条件により【修正④】（`window._memberNameMap` の残留防止）を追加した。修正箇所は3箇所→**5箇所**になった。

---

## 1. 変更対象ファイル

| # | ファイル | 現在の行数 | 変更内容 |
|---|---|---|---|
| 1 | **`index.html`** | 4,380行 | 2箇所 |
| 2 | **`js/ui-helpers.js`** | 475行 | 1関数 |

### 変更してはならないファイル（明示）

| ファイル | 理由 |
|---|---|
| **`supabase/functions/signage-fetch/index.ts`** | **第152回判定により別PR（Issue⑩）。本PRでは絶対に触らない** |
| `signage.html` | 同上 |
| `js/i18n.js` | 本Issueに翻訳キーの追加は無い |
| `js/image.js` / `js/templates.js` / `js/survey.js` / `js/report.js` | 本Issueに変更は無い |
| `js/auth.js` | 同上 |
| `styles.css` | 同上 |
| SQL・RPC・RLS Policy・GRANT | **本Issueに DB変更は無い** |

**新規ファイルを作成しないこと。**

---

## 2. 変更禁止領域（絶対保護）

```
【不可侵・変更禁止】
★最重要：既読・未読の集計に一切影響させないこと

- members 変数の取得条件（index.html L2001〜2002）
  ※ status='approved' のまま維持する。ここを外してはならない
- 既読の名簿を作る処理（index.html L3175 / L3178 / L3187 / L3188）
  ※ L3173 のコメント「members に居ない受信者（退出済み）は自動的に除外される。
    意図どおり」のとおり、既読名簿から退出者を出さないのは意図的な設計である
- realReadMap の構築（index.html L2151〜）
- receiverCount の計算（index.html L2561）
- surveyDenominator の計算（index.html L2582）
- item_receivers の参照ロジック（index.html L3166〜3175・EO-DEC-0125）
- read_receipts / receiver_count に関わる一切の処理
- メンバー一覧の描画（index.html L3439 modal-members / L3884 profile-members）
- 承認待ち（pending）の件数表示
- 権限判定（index.html L3099 / L3310 / L3766 の isCreator / isApprovedMember 判定）
- window._memberJoinedAt の既存の用途（L2149）
- 保護4関数・syncProfileForm()
- signage.html / signage-fetch
```

**★ `members` に退出者を混ぜてはならない。** 混ぜると既読分母・メンバー一覧・承認済み人数のすべてが壊れる。第152回判定が明示的に禁じている。

---

## 3. 設計方針（第152回・ア案）

**名前解決用のデータを、`members` とは別に保持する。**

| 変数 | 用途 | 対象 |
|---|---|---|
| `members`（既存） | メンバー一覧・既読名簿・権限判定 | **`approved` のみ**（変更しない） |
| **`window._memberNameMap`（新設）** | **送信者名の解決のみ** | **全ステータス（`left` を含む）** |

---

## 4. 修正内容（5箇所）

### 4-1 【修正①】既存クエリに `display_name` を追加する

**`index.html` L2139〜L2141 に、全メンバーを取得する既存クエリがある。**

```js
// 現状（L2139〜2141）
const { data: allMembersForJoinedAt } = await supabase.from('group_members')
  .select('eo_uid, created_at')
  .eq('group_session_id', currentGroup.id);
```

**このクエリは `status` で絞っていない**（＝退出者を含む全件を取得している）。**新しいクエリを追加する必要はない。**

**修正後：`select` に `display_name` を追加するだけ。**

```js
const { data: allMembersForJoinedAt } = await supabase.from('group_members')
  .select('eo_uid, display_name, created_at')
  .eq('group_session_id', currentGroup.id);
```

**要点：**
- **新しいクエリを追加しないこと。** 既存クエリの `select` に1語足すだけである
- `.eq('group_session_id', ...)` の条件は変更しない
- **`status` の絞り込みを追加しないこと**（全件取得が本件の前提である）
- 変数名 `allMembersForJoinedAt` は変更しない（既存の用途があるため）

### 4-2 【修正②】名前解決用のマップを作り、window で共有する

**同じ箇所（L2142〜L2149）に、既に `memberJoinedAt` マップを作って `window` で共有する実装がある。**

```js
// 現状（L2142〜2149）
const memberJoinedAt = new Map();
(allMembersForJoinedAt || []).forEach(m => {
  memberJoinedAt.set(m.eo_uid, new Date(m.created_at).getTime());
});
window._memberJoinedAt = memberJoinedAt;
```

**修正後：同じ forEach の中で、名前のマップも作る。**

```js
const memberJoinedAt = new Map();
const memberNameMap = new Map();
(allMembersForJoinedAt || []).forEach(m => {
  memberJoinedAt.set(m.eo_uid, new Date(m.created_at).getTime());
  if (m.display_name) memberNameMap.set(m.eo_uid, m.display_name);
});
window._memberJoinedAt = memberJoinedAt;
window._memberNameMap = memberNameMap;
```

**要点：**
- **既存の `memberJoinedAt` の処理を変更しないこと。** 行を足すだけである
- `window._memberJoinedAt` の代入も変更しない
- `display_name` が空の場合はマップに入れない（`getMemberName` 側でフォールバックさせるため）
- **`window` を使うのは既存の前例（L2149）に倣うためである。** 新しい共有方式を発明しないこと

### 4-3 【修正③】`getMemberName()` にフォールバックを追加する

**`js/ui-helpers.js` L421〜L424。**

```js
// 現状
function getMemberName(eoUid) {
  const member = members.find(m => m.eo_uid === eoUid);
  return member?.display_name || '不明';
}
```

**修正後：`members` で見つからなければ、名前マップを見る。**

```js
function getMemberName(eoUid) {
  const member = members.find(m => m.eo_uid === eoUid);
  if (member?.display_name) return member.display_name;
  // 退出済みメンバー（status='left'）は members に含まれないため、
  // 名前解決用マップから引く（EO-DEC-0152）
  const fromMap = (typeof window !== 'undefined' && window._memberNameMap)
    ? window._memberNameMap.get(eoUid)
    : null;
  return fromMap || '不明';
}
```

**要点：**
- **`members` を先に見る順序を変えないこと。** 現メンバーの名前が優先される
- **マップが未作成でもエラーにならないこと。** `window._memberNameMap` が存在しない場合は従来どおり「不明」を返す
- 表示は「**二郎**」とする。**「二郎（退出）」のような接尾辞を付けないこと**（第152回判定で B案は不採用）

---

### 4-4 【修正④】グループ切替時・0件時にマップをリセットする

**`window` に保持する以上、前のグループの名前マップが残らないようにする必要がある。**

既存の `window._memberJoinedAt` は**2箇所でリセットされている。同じ箇所に `window._memberNameMap` のリセットも追加する。**

#### (a) メッセージ0件のとき（index.html L2043〜L2048）

```js
// 現状
if (messages.length > 0) {
  await applyReadCorrection(messages);
} else {
  // メッセージ0件のときは参加時刻マップを空に初期化（グループ切替時の残留防止）
  window._memberJoinedAt = new Map();
}
```

**修正後：`window._memberNameMap` のリセットを1行追加する。**

```js
if (messages.length > 0) {
  await applyReadCorrection(messages);
} else {
  // メッセージ0件のときは参加時刻マップを空に初期化（グループ切替時の残留防止）
  window._memberJoinedAt = new Map();
  window._memberNameMap = new Map();
}
```

#### (b) グループ切替時（index.html L4301 付近）

```js
// 現状（switchGroup 内）
monthOpenState = {};
window._memberJoinedAt = new Map();
```

**修正後：直後に1行追加する。**

```js
monthOpenState = {};
window._memberJoinedAt = new Map();
window._memberNameMap = new Map();
```

**要点：**

- **既存の `window._memberJoinedAt = new Map();` の行を変更しないこと。** その直後に1行足すだけである
- **リセット箇所を新設しないこと。** 既存の2箇所に合わせる
- `switchGroup()` の他の処理（`messages = []` / `oldestLoadedAt` 等）には触れないこと

**理由**：通常はメッセージが無ければ名前解決も呼ばれないが、`window` に保持する以上、グループ切替・空グループ・例外時の残留を完全に消しておくほうが安全である。**前のグループのメンバー名が別グループで表示される事故を構造的に防ぐ。**

---

## 5. 修正の要約

| # | ファイル | 行 | 変更 |
|---|---|---|---|
| ① | index.html | L2140 | `select` に `display_name` を追加 |
| ② | index.html | L2142〜2149 | `memberNameMap` を作り `window` で共有（3行追加） |
| **④a** | index.html | **L2047 の直後** | **`window._memberNameMap = new Map();` を1行追加** |
| **④b** | index.html | **L4301 の直後** | **`window._memberNameMap = new Map();` を1行追加** |
| ③ | js/ui-helpers.js | L421〜424 | `getMemberName()` にフォールバック追加 |

**実質7行程度の変更である。** これを大きく超える差分になっていたら、余計なことをしている。

---

## 6. なぜ既読集計に影響しないか（実装者向けの根拠）

**`getMemberName()` の呼び出し元は7箇所あり、すべて送信者名の表示である。**

```
index.html L2385  一覧・投稿グループの返信行の送信者名
index.html L2414  一覧・投稿グループの元投稿の送信者名
index.html L2574  一覧・単独投稿の送信者名
index.html L3213  詳細画面の送信者名
index.html L3716  詳細画面・投稿グループの元投稿の送信者名
index.html L3746  詳細画面・返信の送信者名
index.html L3779  返信作成画面の引用元の送信者名
```

**既読の名簿（L3175 / L3178 / L3188）は `members` を直接 filter しており、`getMemberName()` を経由していない。**

したがって修正③は既読集計に影響しない。**この構造を壊さないこと。**

---

## 7. 実装してはならないこと（明示）

| # | 禁止事項 | 理由 |
|---|---|---|
| 1 | `members` の取得条件から `status='approved'` を外す | **第152回判定が明示的に禁止。** 既読分母・メンバー一覧・承認済み人数が壊れる |
| 2 | 既読の名簿（L3175 / L3178）に退出者を含める | 退出者を出さないのは意図的な設計（L3173 のコメント） |
| 3 | `receiver_count` / `realReadMap` / `item_receivers` の処理に触れる | 絶対保護 |
| 4 | 「二郎（退出）」のような接尾辞を付ける | 第152回判定で B案は不採用 |
| 5 | `signage-fetch` / `signage.html` を変更する | **第152回判定により別PR（Issue⑩）** |
| 6 | 新しいクエリを追加する | 既存クエリ（L2139）の `select` に1語足すだけで足りる |
| 7 | `getMemberName()` をグローバルに昇格させる | 既に `ui-helpers.js` にあり、そのまま呼べる |
| 8 | 新規ファイルを作成する | 本件に不要 |
| 9 | `window._memberJoinedAt` のリセット行を変更・削除する | 既存の用途がある。**直後に1行足すだけ**である |
| 10 | 新しいリセット箇所を設ける | 既存の2箇所（L2047 / L4301）に合わせる |

---

## 8. キャッシュクエリの更新（必須）

**`js/ui-helpers.js` を変更するため、`index.html` の script タグを更新する。**

| 行 | 現在 | 更新後 |
|---|---|---|
| **L902** | `js/ui-helpers.js?v=20260724-1` | `js/ui-helpers.js?v=20260724-2` |

**`js/i18n.js`（L901）は変更しないため、クエリも更新しないこと。**

**これを忘れると、利用者の端末で古いJSが読み込まれ続け、修正が反映されない**（学び119）。

---

## 9. PR に必ず記載すること

```
## 対象
- index.html（2箇所）
- js/ui-helpers.js（getMemberName のみ）

## 変更した行
- index.html    L2140      : select に display_name を追加
- index.html    L2142-2149 : memberNameMap を作り window で共有
- index.html    L2047 直後 : window._memberNameMap = new Map(); を追加（0件時）
- index.html    L4301 直後 : window._memberNameMap = new Map(); を追加（グループ切替時）
- index.html    L902       : キャッシュクエリ 20260724-1 → 20260724-2
- ui-helpers.js L421-424   : getMemberName にフォールバック追加

## 触れていないことの確認
- [ ] members の取得条件（status='approved'）を変更していない
- [ ] 既読の名簿（L3175 / L3178 / L3187 / L3188）に触れていない
- [ ] realReadMap / receiverCount / surveyDenominator に触れていない
- [ ] item_receivers の参照ロジックに触れていない
- [ ] メンバー一覧（modal-members / profile-members）に触れていない
- [ ] 権限判定（isCreator / isApprovedMember）に触れていない
- [ ] window._memberJoinedAt の既存の用途・リセット行を変更していない
- [ ] window._memberNameMap のリセットを既存2箇所（L2047 / L4301）に追加した
- [ ] 新しいリセット箇所を設けていない
- [ ] signage-fetch / signage.html を変更していない（別PR）
- [ ] 新しいクエリを追加していない（既存クエリの select に追加のみ）
- [ ] 「（退出）」等の接尾辞を付けていない
- [ ] DB・RPC・Policy・GRANT を変更していない
- [ ] キャッシュクエリを更新した（L902 のみ）
- [ ] 新規ファイルを作成していない
```

---

## 10. 野口さん側の作業

| # | 作業 |
|---|---|
| 1 | **PR マージ前に切り戻しタグを打つ**：`pre-member-name-fix` |
| 2 | 本番反映後、実機確認（第11章） |
| 3 | **LINEアプリを完全終了して開き直す**（学び119） |

---

## 11. 実機確認の項目

**確認に使うデータ**：フロント2の 2026/5/26 の連絡（送信者＝二郎・退出済み）

| # | 確認内容 | 期待値 |
|---|---|---|
| **1** | フロント2の一覧・5/26の連絡 | 送信者名が「**二郎**」と表示される |
| **2** | その連絡の詳細画面 | 送信者名が「**二郎**」 |
| **3** | 投稿グループの元投稿部分 | 送信者名が「**二郎**」 |
| 4 | 「（退出）」等の接尾辞 | **付いていない** |
| **5** | **メンバー一覧** | **二郎が出ていない**（従来どおり） |
| **6** | **既読の数字** | **変わっていない**（修正前と同じ数値） |
| **7** | **未読の名簿** | **二郎が入っていない**（従来どおり） |
| 8 | 現メンバーの送信者名 | 従来どおり正しく出る |
| 9 | 承認待ちの件数 | 変わっていない |
| 10 | サイネージ画面 | **変わっていない**（本PRの対象外） |
| **11** | **グループを切り替える**（フロント2 → 江の島フットボールクラブ） | **前グループの名前が混ざらない**（「二郎」が出ない） |
| **12** | **メッセージ0件のグループを開く** | エラーが出ず、正常に表示される |

**5・6・7 が最重要である。** 名前が出るようになった代わりに既読集計やメンバー一覧が壊れていないことを、必ず確認すること。

**11・12 は残留防止の確認である。** グループを切り替えたあと、前のグループのメンバー名が表示されないことを必ず確認すること。

---

## 12. 参照文書

| 文書 | 該当箇所 |
|---|---|
| EO-DEC-0152（第152回判定） | **本書の根拠**（A案＋ア案） |
| EO-DEC-0125（第125回） | item_receivers によるスナップショット方式 |
| 分割定義仕様書 v1.3 | 第3章（サイネージの独立）・第5章（グローバル昇格の禁止） |

以上。
