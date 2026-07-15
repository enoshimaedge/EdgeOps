# 実装指示書：画像投稿の全メンバー開放（v1.0）

**前提：第119回判定（EO-DEC-0119）GO後に着手すること。**
サーバ側（Edge Function）を含む不可逆変更のため、判定前は実装しない。

---

## 目的

画像投稿を「グループ管理者（`is_creator=true`）のみ」から「承認済み（`status=approved`）かつ非サイネージのメンバー全員」へ開放する。クォータは据え置き（個人単位・連絡10回/日・引き継ぎ5回/日）。

---

## 変更対象は5箇所（フロント4・サーバ1）

**5箇所すべてを同一リリースで反映すること。** 片側だけだとボタンは出るのにサーバで弾かれる（または逆）不整合になる。

---

## 事前作業

**公開前に切り戻し用タグを打つ。**

```
git tag pre-image-openall
git push origin pre-image-openall
```

---

## 変更① `js/ui-helpers.js` L15（ボタン表示制御）

`applyImageUploadButtonVisibility()` 内の isCreator ガードを削除する。

**削除前：**
```js
  const hideBoth = () => { btnCamera.style.display = 'none'; btnLibrary.style.display = 'none'; };
  if (isCreator !== true) { hideBoth(); return; }
  try {
```

**削除後：**
```js
  const hideBoth = () => { btnCamera.style.display = 'none'; btnLibrary.style.display = 'none'; };
  // [第119回] is_creator 限定を撤回。表示可否は feature_flags のみで判定。
  try {
```

→ `if (isCreator !== true) { hideBoth(); return; }` の1行を削除。

---

## 変更② `js/ui-helpers.js` L70（クォータUI）

`updateImageQuotaUI()` 内、残量表示を消す条件から isCreator を外す。

**変更前：**
```js
  if ((btnCamera.style.display === 'none' && btnLibrary.style.display === 'none') || isCreator !== true) {
    quotaEl.innerHTML = '';
    return;
  }
```

**変更後：**
```js
  // [第119回] isCreator 条件を除去。両ボタン非表示（feature_flags OFF）のときのみ空に。
  if (btnCamera.style.display === 'none' && btnLibrary.style.display === 'none') {
    quotaEl.innerHTML = '';
    return;
  }
```

→ `|| isCreator !== true` を削除。

---

## 変更③ `js/image.js` L208-212（ファイル選択時ガード）

`onComposeImageFileSelected()` 内のガードブロックを削除する。

**削除するブロック：**
```js
  // [チャッピー第52回判定 修正2] isCreator !== true なら拒否(表示制御の二重防御)
  if (isCreator !== true) {
    showToast('画像投稿はグループ管理者のみ利用できます');
    return;
  }
```

→ この4行を丸ごと削除。直後のクォータ残量チェック（getRemainingQuota）はそのまま残す。

---

## 変更④ `js/image.js` L303-307（送信時ガード）

`sendImageMessage()` 内のガードブロックを削除する。

**削除するブロック：**
```js
  // [チャッピー第52回判定 修正2] isCreator !== true なら送信拒否(送信入口の二重防御)
  if (isCreator !== true) {
    showToast('画像投稿はグループ管理者のみ利用できます');
    return;
  }
```

→ この5行を丸ごと削除。直後のアンケート画像ガード（第54回）はそのまま残す。

---

## 変更⑤ `supabase/functions/upload-image/index.ts` Step 4（サーバ認可）

共通関数 `isApprovedCreator()` の呼び出しを、Function内で完結する「approved かつ 非サイネージ」判定へ差し替える。**`_shared/auth.ts` の `isApprovedCreator` 自体は絶対に変更しないこと**（他Edge Functionが共用）。

**変更前：**
```ts
    // ===== Step 4: 認可判定（group_members で is_creator=true・status=approved） =====
    const isCreator = await isApprovedCreator(supabase, eoUid, groupSessionId);
    if (!isCreator) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'PERMISSION_DENIED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('PERMISSION_DENIED', requestId, '投稿権限がありません');
    }
```

**変更後：**
```ts
    // ===== Step 4: 認可判定（approved かつ 非サイネージ）=====
    // [第119回] 画像投稿の is_creator 限定を撤回。approved・非サイネージなら投稿可。
    //   is_creator は不参照（他機能では継続使用）。共通関数 isApprovedCreator は不変更。
    const { data: posterMember, error: posterError } = await supabase
      .from('group_members')
      .select('is_signage, status')
      .eq('eo_uid', eoUid)
      .eq('group_session_id', groupSessionId)
      .eq('status', 'approved')
      .maybeSingle();

    if (posterError || !posterMember || posterMember.is_signage === true) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'PERMISSION_DENIED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('PERMISSION_DENIED', requestId, '投稿権限がありません');
    }
```

**注意：** `isApprovedCreator` の import が他で使われていなければ、未使用importの警告が出る。import文からの除去は upload-image/index.ts 内でのみ行い、`_shared/auth.ts` からの export は残すこと。

---

## 触ってはいけないもの（厳守）

- クォータ（`increment_image_quota` / `QUOTA_LIMITS`）── 個人単位のまま
- `is_creator` フラグ・判定ロジック
- `_shared/auth.ts` の `isApprovedCreator` 関数本体・export
- `messages` / `handover_notes` のスキーマ・INSERTロジック（receiver_count 固定含む）
- `signage.html`
- feature_flags（4フラグ）

---

## 動作確認（本番反映前）

1. **非管理者メンバー**でcompose画面を開き、画像ボタン（📷/🖼️）が表示されること
2. 非管理者メンバーで画像付き投稿が成功すること・残量が正しく減ること
3. 非管理者が連絡で11回目を撃つと `本日の上限(10回)に達しました` になること（クォータ据え置き確認）
4. **サイネージ端末（is_signage=true）** から投稿を試み、`PERMISSION_DENIED` で弾かれること
5. **pending / 退出済** のユーザーが弾かれること（従来どおり）
6. 管理者は従来どおり投稿できること
7. `feature_flags.image_upload=false` で全メンバーのボタンが消えること（緊急OFF確認）

---

## 切り戻し

問題があれば `git reset --hard pre-image-openall` でフロントを戻し、Edge Function は Step 4 を元の `isApprovedCreator` 呼び出しへ戻して再デプロイする。
