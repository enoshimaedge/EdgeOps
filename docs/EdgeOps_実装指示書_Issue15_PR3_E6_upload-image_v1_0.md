# EdgeOps 実装指示書 Issue⑮（PR3）
## E6 写真投稿権限 ― event では管理者のみ（upload-image・案カ）

**版**:v1.0 / **作成**:2026/7/27
**根拠**:第154回判定(EO-DEC-0154)・仕様書v1.7 第10章・22-5
**正本**:`EdgeOps_ST版イベント催事モード仕様書_v1_7.docx`
**前提**:リポジトリの `supabase/functions/upload-image/index.ts` が本番デプロイ版と一致していること(**2026/7/27 に照合済み・一致を確認**)

---

## 0. 絶対条件(最優先)

> ### 通常グループ(`industry !== 'event'`)の投稿可否を、一切変更しないこと。

- 第119回判定(**approved・非サイネージなら投稿可。is_creator は不参照**)は通常グループの確定判定であり、本Issueで覆さない(仕様書22-5)。新設ガードは `industry === 'event'` のときのみ発火する。
- `industry` を**フロントから受け取らない**(案キ不採用・22-5)。必ずサーバー側で `group_sessions` から取得する。
- token/eo_uid 解決・レート制限・クォータ加算・source_id 生成・Storage 書き込み・messages/handover_notes への INSERT・ログ・ロールバック処理には**一切触れない**。
- `_shared/` 配下(auth.ts / cors.ts / errors.ts / logger.ts / ratelimit.ts)は**変更しない**。
- 共通関数 `isApprovedCreator` は不変更(第119回の注記どおり)。

## 1. 変更対象ファイル(この1つ以外を変更しないこと)

1. `supabase/functions/upload-image/index.ts`

**変更禁止**:`supabase/functions/_shared/` 配下すべて、`supabase/functions/signage-fetch/` 配下、`index.html`、`js/` 配下、`signage.html`、その他すべて

## 2. 実装内容

対象は「`===== Step 4: 認可判定`」コメントのブロック。**行番号ではなくこのコメントで特定すること。**

### 2-1. select に `is_creator` を追加

```ts
// 変更前
.select('is_signage, status')
// 変更後
.select('is_signage, status, is_creator')
```

既存の PERMISSION_DENIED 判定(`posterError || !posterMember || posterMember.is_signage === true`)は**そのまま**。

### 2-2. 既存判定の直後に Step 4-2 を追加

```ts
    // ===== Step 4-2: [E6 案カ / EO-DEC-0154] event では管理者のみ投稿可 =====
    // 第119回判定(approved・非サイネージなら投稿可)は通常グループの判定であり変更しない(仕様書22-5)。
    // industry はフロントから受け取らず、サーバー側で取得する(案キ不採用)。
    const { data: groupRow, error: groupRowError } = await supabase
      .from('group_sessions')
      .select('industry')
      .eq('id', groupSessionId)
      .maybeSingle();

    if (groupRowError || !groupRow) {
      // グループを特定できない場合は安全側で拒否(既存の posterError と同じ扱い)
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

    if (groupRow.industry === 'event' && posterMember.is_creator !== true) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'PERMISSION_DENIED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('PERMISSION_DENIED', requestId, 'イベントでは写真の投稿は主催者のみ可能です');
    }
```

ログ呼び出しは既存 Step 4 の `logFunction` と**同一形式**とすること。

## 3. 完了条件

- 変更が `supabase/functions/upload-image/index.ts` の Step 4 周辺のみであること
- select に `is_creator` が追加されていること
- 新設ガードの発火条件が `industry === 'event'` に限定されていること(通常グループの経路は不変更)

## 4. デプロイ(マージ後・野口さん作業)

1. マージ後、`supabase/functions/upload-image/index.ts` の**全文**を Supabase ダッシュボードへ貼り付けてデプロイ(自動反映されない)
2. デプロイ順序は**サーバー側(本Issue)が先**。フロントの画像ボタン非表示(第10章の表示側)は未実装のため、一般参加者にボタンが見える期間が生じるが、押してもサーバーで拒否されるため安全側

## 5. 動作確認

### A. 通常グループ(フロント/江の島フットボールクラブ・社員⭐︎禁止)

| # | 立場 | 確認内容 | 期待 |
|---|---|---|---|
| 1 | 一般メンバー(非creator) | 連絡に画像添付して投稿 | **できる**(変化なし・第119回維持) |
| 2 | 管理者 | 画像投稿 | できる |

### B. event(テストイベントA)

| # | 立場 | 確認内容 | 期待 |
|---|---|---|---|
| 1 | 主催者 | 画像投稿 | **できる** |
| 2 | 一般参加者 | 画像投稿 | **エラーになる**(「イベントでは写真の投稿は主催者のみ可能です」) |

## 6. スコープ外(別Issue)

**表示側**(第10章:「event かつ is_creator=false では compose-image-btn 系を出さない」)は、`js/ui-helpers.js` の `applyImageUploadButtonVisibility()` に event 条件が無いことを実コードで確認済みだが、Edge Function と同一PRに混ぜない原則(第154回)により**本Issueに含めない**。Issue⑰(E8・スマホ側)への同梱を推奨(要・野口さん判断)。

## 7. 参考:実コードで確認済みの事実(2026/7/27・本番取得コード)

| # | 事実 |
|---|---|
| 1 | Step 4 は `group_members` を `is_signage, status` で select し、approved・非サイネージのみ通過させている(第119回準拠) |
| 2 | `supabase` は service role クライアント(`getServiceClient`)であり、`group_sessions` の参照が可能 |
| 3 | リポジトリの upload-image は本番デプロイ版と一致(2026/7/27 照合) |
| 4 | `metadata.group_session_id` は UUID で、Step 4 で `groupSessionId` として使用済み |
