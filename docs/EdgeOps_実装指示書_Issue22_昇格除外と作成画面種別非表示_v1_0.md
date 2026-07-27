# EdgeOps 実装指示書 Issue㉒
## A:主催者昇格の候補からサイネージ端末を除外(案イ・全グループ共通) ＋ B:作成画面の「引き継ぎノート」種別を event で非表示(第13章補完)

**版**:v1.0 / **作成**:2026/7/27
**根拠**:A＝第160回判定 論点A GO(EO-DEC-0160・不具合修正扱い) ／ B＝仕様書v1.7 第13章(確定済み仕様「作成ボタンを表示しない」)の実装漏れ補完
**前提**:Issue⑭・⑲・⑰ マージ済み
**旧番号**:Issue⑳・㉑ の統合版(⑳㉑は欠番)

> **行番号は 2026/7/27 時点 main の実測値。行番号ではなく関数名・要素IDで対象を特定すること。**

---

## 0. 絶対条件

### A(昇格除外)について
- 変更は**昇格候補の選定条件のみ**。主催者退出のブロックはしない(第160回条件)
- 退出時の未読既読化(read_receipts 補完)・自分自身の UPDATE(`status:'left', is_creator:false, is_signage:false`)・アンケート回答削除(16-A-6)など leaveGroup 内の既存処理には触れない
- `resolveIsCreator()` の「DB に is_creator=true が1人でもいれば DB の値を使う」判定は変更しない
- **該当する人間メンバーがいない場合は、無理に昇格させない**(第160回条件)
- ★**`is_signage` は NULL があり得る**(旧メンバー)。除外は `.or('is_signage.eq.false,is_signage.is.null')` ／ JS側は `m.is_signage !== true` を使う。**`.eq('is_signage', false)` 単独は不可**(NULL の人間が候補から漏れる)

### B(種別非表示)について
- event(`industry === 'event'`)の**全員(主催者含む)**に適用。判定は `currentGroup?.industry === 'event'`
- 表示制御のみ。送信RPC・handover_notes・DB には触れない
- 通常グループではトグルに display '' を再設定するのみ(見た目不変・またぎ切替時の復元用)

## 1. 変更対象ファイル(この1つ以外を変更しないこと)

1. `index.html` — A:2箇所、B:2箇所、計4箇所

**変更禁止**:`js/` 配下すべて(`applyEventUiVisibility()` は index.html 内の関数)、`signage.html`、`styles.css`、`admin.html`、`supabase/functions/` 配下すべて

**キャッシュクエリの変更なし**(js ファイルに差分が無いため。ui-helpers 等のクエリを動かしたらNG)

## 2. A:主催者昇格のサイネージ除外(2箇所)

### 2-1. `leaveGroup()`(L4177付近)の昇格候補クエリ

```js
// 変更前
      const { data: remainingMembers } = await supabase
        .from('group_members')
        .select('id, created_at')
        .eq('group_session_id', currentGroup.id)
        .eq('status', 'approved')
        .neq('id', currentMemberId)
        .order('created_at', { ascending: true })
        .limit(1);
// 変更後
      // [EO-DEC-0160 案イ] サイネージ端末は主催者昇格の対象外(NULL は人間扱い)
      const { data: remainingMembers } = await supabase
        .from('group_members')
        .select('id, created_at')
        .eq('group_session_id', currentGroup.id)
        .eq('status', 'approved')
        .neq('id', currentMemberId)
        .or('is_signage.eq.false,is_signage.is.null')
        .order('created_at', { ascending: true })
        .limit(1);
```

後続の「remainingMembers があれば is_creator=true を付与」の処理は**そのまま**(候補0件なら何もしない＝無理に昇格させない、が既存構造で自然に成立)。

### 2-2. `resolveIsCreator()`(L1600付近)のフォールバック

select に `is_signage` を追加:

```js
// 変更前
      .select('id, is_creator, created_at')
// 変更後
      .select('id, is_creator, created_at, is_signage')
```

フォールバック行を差し替え:

```js
// 変更前
    // 誰もTRUEでなければ最古メンバーを管理者とみなす（フォールバック）
    return allMembers[0].id === myMemberId;
// 変更後
    // 誰もTRUEでなければ最古の人間メンバーを管理者とみなす（フォールバック）
    // [EO-DEC-0160 案イ] サイネージ端末は対象外(NULL は人間扱い)。人間がいなければ昇格させない
    const humanMembers = allMembers.filter(m => m.is_signage !== true);
    if (humanMembers.length === 0) return false;
    return humanMembers[0].id === myMemberId;
```

`hasCreator` 判定は**変更しない**。

## 3. B:作成画面の「引き継ぎノート」種別を非表示(2箇所)

**経緯**:Issue⑲は入口3つ(タブ・未確認バッジ・「すべて見る」)を塞いだが、作成画面(screen-compose)の種別トグル `ctype-handover`(L459)が残っており、event で誰でも引き継ぎを投稿できてしまう(実機確認 2026/7/27。一覧非表示のためデータが宙に浮くだけだが塞ぐ)。screen-handover 内の「新しい引き継ぎ」ボタン(L660)は event では画面ごと到達不能のため対象外。

### 3-1. `applyEventUiVisibility()`(Issue⑲で新設)に1ブロック追加

`chipAll` の処理の直後に:

```js
  // [第13章補完 / Issue㉒-B] 作成画面の「引き継ぎノート」種別トグルも event では出さない(全員)
  const ctypeHandover = document.getElementById('ctype-handover');
  if (ctypeHandover) ctypeHandover.style.display = ev ? 'none' : '';
```

### 3-2. `selectComposeType(type)`(L2876付近)の冒頭に保険ガード

```js
function selectComposeType(type) {
  // [第13章補完 / Issue㉒-B] event では引き継ぎ種別を選択させない(直接呼び出しの保険)
  if (type === 'handover' && currentGroup?.industry === 'event') type = 'msg';
  selectedComposeType = type;
  applyComposeType(type);
}
```

`applyComposeType()`・`showCompose()`・送信処理は**変更しない**。

## 4. 完了条件

- 変更が index.html の上記4箇所のみであること
- A の除外条件が `.or('is_signage.eq.false,is_signage.is.null')` ／ `m.is_signage !== true` であること
- キャッシュクエリに差分が無いこと

## 5. 動作確認

### B(先に・テストイベントA でそのまま確認可)

| # | 立場 | 確認 | 期待 |
|---|---|---|---|
| 1 | 主催者・一般参加者とも | 作成画面 | **「通常メッセージ」のみ**(引き継ぎトグルが出ない) |
| 2 | — | event→通常グループへまたぎ切替後の作成画面 | トグルが2つに戻る |
| 3 | 通常グループ | 種別トグル・引き継ぎ投稿 | 変化なし |

### A(★テスト専用グループを新規作成して実施。フロント/江の島FC/社員⭐︎は使わない — 退出・昇格を伴うため)

| # | 手順 | 期待 |
|---|---|---|
| 1 | 端末Aでグループ作成 → 端末Bが通常参加・承認 → Aが退出 | **Bが管理者になる** |
| 2 | 別グループ:端末A作成 → 端末Bが**サイネージとして**参加・承認 → 端末Cが通常参加・承認 → Aが退出 | **Cが管理者になる**(Bは昇格しない) |
| 3 | event:主催者作成 → サイネージ参加 → 出展者参加 → 主催者退出 | **出展者が主催者になる**(承認アイコン・写真投稿可) |

※実施後のテストグループは放置でよい(event は期限切れで自然消滅。通常グループ側は名前に「テスト」と明記)。
