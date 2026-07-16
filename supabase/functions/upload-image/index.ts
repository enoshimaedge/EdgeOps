// supabase/functions/upload-image/index.ts
// 画像投稿 Edge Function（仕様書v2.5 9-4節準拠・v2.4 INSERT統一）
// [2026-06-29] messages の receiver_count を送信時点で固定保存するよう修正
//   （画像メッセージの既読バー分母が新規参加で増える不具合の修正・handover無変更）
//
// 処理フロー：
//  1. Authorization 検証 → eo_uid 取得
//  2. metadata パース・必須フィールド検証
//  3. レート制限チェック（10件/分）
//  4. group_members で投稿権限確認
//  5. increment_image_quota 呼び出し
//  6. source_id 生成
//  7. Storage path 組み立て・書き込み（フル画像・サムネ）
//  8. messages または handover_notes に新規INSERT
//  9. image_function_log に記録
// 10. 成功レスポンス
// 11. 失敗時：Storage 書き込み済みなら即削除（ロールバック）

import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import {
  resolveEoUid,
  getServiceClient,
} from '../_shared/auth.ts';
import {
  errorResponse,
  successResponse,
  generateRequestId,
  ErrorCode,
} from '../_shared/errors.ts';
import { checkRateLimit, RATE_LIMITS } from '../_shared/ratelimit.ts';
import { logFunction } from '../_shared/logger.ts';

const QUOTA_LIMITS = {
  message: 10,
  handover: 5,
} as const;

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TOTAL_SIZE = 6 * 1024 * 1024; // 6MB（フル + サムネ + メタデータ余裕）

interface UploadMetadata {
  body: string;
  group_session_id: string; // UUID
  context: 'message' | 'handover';
  image_mode: 'expandable' | 'fixed';
  priority?: string; // message: info|normal|urgent / handover: action|check|done
}

Deno.serve(async (req: Request) => {
  // CORS preflight
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  // POST のみ受け付け
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();
  const requestId = generateRequestId();
  const supabase = getServiceClient();

  let eoUid: string | undefined;
  let groupSessionId: string | undefined;
  let storageUploaded: { fullPath?: string; thumbPath?: string } = {};

  try {
    // ===== Step 1: Authorization 検証 → eo_uid 取得 =====
    const authResult = await resolveEoUid(req, supabase);
    if (!authResult.ok || !authResult.eoUid) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        status: 'fail',
        errorCode: authResult.errorCode,
        durationMs: Date.now() - startTime,
      });
      return errorResponse(authResult.errorCode!, requestId);
    }
    eoUid = authResult.eoUid;

    // ===== Step 2: multipart/form-data パース =====
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        status: 'fail',
        errorCode: 'VALIDATION_ERROR',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('VALIDATION_ERROR', requestId, 'multipart/form-data パースに失敗しました');
    }

    const metadataRaw = formData.get('metadata');
    const fullImage = formData.get('fullImage');
    const thumbnail = formData.get('thumbnail');

    if (!metadataRaw || !fullImage || !thumbnail) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        status: 'fail',
        errorCode: 'VALIDATION_ERROR',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('VALIDATION_ERROR', requestId, 'metadata / fullImage / thumbnail が必須です');
    }

    let metadata: UploadMetadata;
    try {
      metadata = JSON.parse(metadataRaw.toString()) as UploadMetadata;
    } catch {
      return errorResponse('VALIDATION_ERROR', requestId, 'metadata の JSON パースに失敗しました');
    }

    // メタデータ検証
    if (
      !metadata.body ||
      !metadata.group_session_id ||
      !metadata.context ||
      !['message', 'handover'].includes(metadata.context) ||
      !metadata.image_mode ||
      !['expandable', 'fixed'].includes(metadata.image_mode)
    ) {
      return errorResponse('VALIDATION_ERROR', requestId, 'metadata のフィールドが不足または不正です');
    }

    // [priority対応 2026/6/15] 画像付き投稿でも優先度を保存する。
    //   message  : info(緑) / normal(黄) / urgent(赤)  ・デフォルト info
    //   handover : action(赤) / check(黄) / done(緑)   ・デフォルト action
    //   不正値・未指定はcontextごとのデフォルトに丸める（壊さない方針）
    const MSG_PRIORITIES = ['info', 'normal', 'urgent'];
    const HOV_PRIORITIES = ['action', 'check', 'done'];
    let safePriority: string;
    if (metadata.context === 'message') {
      safePriority = MSG_PRIORITIES.includes(metadata.priority ?? '') ? metadata.priority! : 'info';
    } else {
      safePriority = HOV_PRIORITIES.includes(metadata.priority ?? '') ? metadata.priority! : 'action';
    }

    groupSessionId = metadata.group_session_id;

    // ファイル検証
    if (!(fullImage instanceof File) || !(thumbnail instanceof File)) {
      return errorResponse('VALIDATION_ERROR', requestId, 'fullImage / thumbnail は File 型である必要があります');
    }

    // MIME チェック
    if (!ALLOWED_MIMES.includes(fullImage.type)) {
      return errorResponse('INVALID_MIME', requestId, `対応していないMIMEタイプ: ${fullImage.type}`);
    }

    // サイズチェック
    if (fullImage.size > MAX_FILE_SIZE) {
      return errorResponse('FILE_TOO_LARGE', requestId, `フル画像サイズ ${fullImage.size} bytes が上限 ${MAX_FILE_SIZE} を超えています`);
    }

    // ===== Step 3: レート制限チェック =====
    const rateKey = `upload:${eoUid}`;
    const rateResult = checkRateLimit(rateKey, RATE_LIMITS.upload);
    if (!rateResult.allowed) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'RATE_LIMIT_EXCEEDED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse(
        'RATE_LIMIT_EXCEEDED',
        requestId,
        undefined,
        { 'Retry-After': String(rateResult.retryAfterSeconds) },
      );
    }

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

    // ===== Step 5: クォータ加算 =====
    const limit = QUOTA_LIMITS[metadata.context];
    const { data: quotaCount, error: quotaError } = await supabase.rpc(
      'increment_image_quota',
      {
        p_eo_uid: eoUid,
        p_group_session_id: groupSessionId,
        p_context: metadata.context,
        p_limit: limit,
      },
    );

    if (quotaError) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'DB_FAILED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('DB_FAILED', requestId, 'クォータ加算に失敗しました');
    }

    if (quotaCount === null) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'QUOTA_EXCEEDED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('QUOTA_EXCEEDED', requestId);
    }

    const remainingQuota = limit - (quotaCount as number);

    // ===== Step 6: source_id 生成 =====
    const now = new Date();
    const datePrefix = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = metadata.context === 'message' ? 'msg' : 'hov';
    const seqRandom = Math.floor(Math.random() * 9000) + 1000; // 4桁
    const sourceId = `${prefix}_${datePrefix}_${seqRandom}`;

    // ===== Step 7: Storage 書き込み =====
    const fullPath = `${groupSessionId}/${metadata.context}/${sourceId}/IMG_0001.jpg`;
    const thumbPath = `${groupSessionId}/${metadata.context}/${sourceId}/THM_0001.jpg`;

    const { error: fullUploadError } = await supabase.storage
      .from('edgeops-images')
      .upload(fullPath, fullImage, {
        contentType: fullImage.type,
        upsert: false,
      });

    if (fullUploadError) {
      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'STORAGE_FAILED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('STORAGE_FAILED', requestId, 'フル画像書き込み失敗');
    }
    storageUploaded.fullPath = fullPath;

    const { error: thumbUploadError } = await supabase.storage
      .from('edgeops-images')
      .upload(thumbPath, thumbnail, {
        contentType: thumbnail.type,
        upsert: false,
      });

    if (thumbUploadError) {
      // フル画像を削除してロールバック
      await supabase.storage.from('edgeops-images').remove([fullPath]);
      storageUploaded = {};

      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'STORAGE_FAILED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('STORAGE_FAILED', requestId, 'サムネイル書き込み失敗');
    }
    storageUploaded.thumbPath = thumbPath;

    // ===== Step 8: messages または handover_notes に新規INSERT =====
    const tableName = metadata.context === 'message' ? 'messages' : 'handover_notes';

    // [チャッピー第53回判定 修正] messages.id は uuid型(gen_random_uuid)・sourceIdは文字列なので入れない
    // sourceIdはStorageパス専用・messages.idはDB自動採番(UUID)
    // [チャッピー第53回判定 修正・2回目] messages と handover_notes のスキーマ違い対応
    //   messages: body・sender_eo_uid
    //   handover_notes: content(body相当)・sender_eo_uid・sender_name(NOT NULL・追加)
    let insertData;
    let rcMembers: Array<{ eo_uid: string; is_signage: boolean | null }> | null = null;
    if (metadata.context === 'message') {
      // ════════════════════════════════════════════════════════════
      // [receiver_count 送信時固定 / 画像メッセージ対応 / 2026-06-29]
      // 背景：テキスト送信は index.html が receiver_count を送信時点で固定保存。
      //       画像メッセージは Edge Function 経由のため未保存(NULL)となり、
      //       表示側フォールバックが「現在メンバー数」を分母にしていたため、
      //       新規参加者が増えると過去の画像メッセージの分母が増えて
      //       既読バーが緑→オレンジに変わる不具合があった。
      // 対応：テキスト経路と同一定義で受信対象数を算出し receiver_count に保存。
      //       定義 = approved・非サイネージ・送信者を除いたメンバー数。
      //       handover_notes は receiver_count を使用しないため対象外（無変更）。
      // ════════════════════════════════════════════════════════════
      let receiverCountAtSend: number | null = null;
      const { data: rcMembersData, error: rcError } = await supabase
        .from('group_members')
        .select('eo_uid, is_signage')
        .eq('group_session_id', groupSessionId)
        .eq('status', 'approved');
      if (!rcError && Array.isArray(rcMembersData)) {
        rcMembers = rcMembersData;
        receiverCountAtSend = rcMembersData.filter(
          (m) => m.eo_uid !== eoUid && m.is_signage !== true,
        ).length;
      }
      // 取得失敗時は null のまま保存（表示側フォールバックに委ね、誤った固定値は入れない）

      insertData = {
        body: metadata.body,
        group_session_id: groupSessionId,
        sender_eo_uid: eoUid,
        priority: safePriority,
        receiver_count: receiverCountAtSend,
        image_url: fullPath,
        thumbnail_url: thumbPath,
        image_mode: metadata.image_mode,
        image_size: fullImage.size,
        thumbnail_size: thumbnail.size,
        image_uploaded_at: now.toISOString(),
        created_at: now.toISOString(),
      };
    } else {
      // handover: content + sender_name 必須・group_members から display_name 取得
      const { data: memberData, error: memberError } = await supabase
        .from('group_members')
        .select('display_name')
        .eq('eo_uid', eoUid)
        .eq('group_session_id', groupSessionId)
        .eq('status', 'approved')
        .single();

      if (memberError || !memberData) {
        await supabase.storage.from('edgeops-images').remove([fullPath, thumbPath]);
        await logFunction(supabase, {
          requestId,
          functionName: 'upload-image',
          eoUid,
          groupSessionId,
          status: 'fail',
          errorCode: 'DB_FAILED',
          durationMs: Date.now() - startTime,
        });
        return errorResponse('DB_FAILED', requestId, 'メンバー情報の取得に失敗しました');
      }

      insertData = {
        content: metadata.body,
        sender_name: memberData.display_name,
        group_session_id: groupSessionId,
        sender_eo_uid: eoUid,
        priority: safePriority,
        image_url: fullPath,
        thumbnail_url: thumbPath,
        image_mode: metadata.image_mode,
        image_size: fullImage.size,
        thumbnail_size: thumbnail.size,
        image_uploaded_at: now.toISOString(),
        created_at: now.toISOString(),
      };
    }

    const { data: insertedData, error: insertError } = await supabase
      .from(tableName)
      .insert(insertData)
      .select('id')
      .single();

    if (insertError || !insertedData) {
      // Storage を削除してロールバック（孤児防止）
      await supabase.storage.from('edgeops-images').remove([fullPath, thumbPath]);

      // チャッピー第47回判定 注意3：クォータ消費はログ記録のみ・補正は許容（初期実装）
      console.error('DB INSERT failed but quota was consumed:', { eoUid, groupSessionId, sourceId });

      await logFunction(supabase, {
        requestId,
        functionName: 'upload-image',
        eoUid,
        groupSessionId,
        status: 'fail',
        errorCode: 'DB_FAILED',
        durationMs: Date.now() - startTime,
      });
      return errorResponse('DB_FAILED', requestId, 'DB書き込み失敗');
    }

    // ===== 受信者スナップショット（連絡のみ・EO-DEC-0124）=====
    // context==='message' かつ rcMembers 取得成功時のみ保存する。
    // handover は対象外。rcMembers の filter 条件は receiver_count 算出と同一。
    if (metadata.context === 'message' && Array.isArray(rcMembers)) {
      const receiverRows = rcMembers
        .filter((m) => m.eo_uid !== eoUid && m.is_signage !== true)
        .map((m) => ({
          item_type: 'message',
          item_id: insertedData.id,
          group_session_id: groupSessionId,
          receiver_eo_uid: m.eo_uid,
        }));
      if (receiverRows.length > 0) {
        const { error: irError } = await supabase
          .from('item_receivers')
          .insert(receiverRows);
        if (irError) {
          // スナップショット保存失敗は投稿自体を失敗させない（本体は既に保存済み）。
          // ログのみ残し、後追い調査対象とする。
          console.error('item_receivers insert failed (image message):', {
            eoUid, groupSessionId, messageId: insertedData.id, irError,
          });
        }
      }
    }

    // ===== Step 9: 成功ログ =====
    await logFunction(supabase, {
      requestId,
      functionName: 'upload-image',
      eoUid,
      groupSessionId,
      status: 'success',
      durationMs: Date.now() - startTime,
    });

    // ===== Step 10: 成功レスポンス =====
    return successResponse(
      {
        message_id: insertedData.id,
        remaining_quota: remainingQuota,
      },
      requestId,
    );
  } catch (e) {
    console.error('upload-image unexpected error:', e);

    // 失敗時の Storage ロールバック
    if (storageUploaded.fullPath || storageUploaded.thumbPath) {
      const pathsToRemove = [storageUploaded.fullPath, storageUploaded.thumbPath].filter(
        (p): p is string => !!p,
      );
      await supabase.storage.from('edgeops-images').remove(pathsToRemove);
    }

    await logFunction(supabase, {
      requestId,
      functionName: 'upload-image',
      eoUid,
      groupSessionId,
      status: 'fail',
      errorCode: 'INTERNAL_ERROR',
      durationMs: Date.now() - startTime,
    });
    return errorResponse('INTERNAL_ERROR', requestId);
  }
});
