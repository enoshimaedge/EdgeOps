// ════════════════════════════════════════════════════════════════
// EdgeOps signage-fetch Edge Function
// ════════════════════════════════════════════════════════════════
// 用途: サイネージ端末用のデータ取得 (token認証・service_role使用)
//
// 設計原則:
//   - サイネージ8原則を維持 (URL形式・gid非含有・token認証・5分再検証等)
//   - signage_token はリクエスト受領のみ・レスポンスには含めない (チャッピー修正1)
//   - token本体をログ出力しない (チャッピー修正2)
//   - handover_confirmations は handover_id カラム (実カラム確認済)
//   - Promise.allSettled の部分失敗はログに残す (チャッピー修正4)
//
// チャッピー第68回判定 条件付きGO 反映版
// 作成: 2026-05-22 / Claude (Web版)
//
// 2026-07-22 改修 (第142回 EO-DEC-0142・例外承認):
//   - 元投稿の補完取得を追加 (5-2)。60日より古い元投稿への返信に対応
//   - token認証・エラー分類・handover取得・応答構造には一切触れていない
// ════════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// ─── CORS ヘッダ ─────────────────────────────────────────
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ─── レスポンス生成ヘルパー ──────────────────────────────
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(rid: string, errorCode: string, status: number, internalNote?: string): Response {
  // 内部ログ(エラーコードは内部識別用・本体ログのみ)
  console.log(JSON.stringify({
    rid,
    step: 'error_response',
    error_code: errorCode,
    status,
    note: internalNote || null,
  }));

  // クライアント表示は統一文言 (チャッピー論点6: 状態推測を許さない)
  return jsonResponse({
    ok: false,
    rid,
    error_code: errorCode,
    message: 'サイネージが無効になりました',
  }, status);
}

// ─── token ハッシュプレフィックス生成 (ログ用・本体は出さない) ───
async function tokenHashPrefix(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 8); // 先頭8文字のみ (識別用・元token復元不可)
}

// ─── 部分失敗ログヘルパー (チャッピー修正4) ───────────────
function logPartialFailure(rid: string, step: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === 'rejected') {
    console.log(JSON.stringify({
      rid,
      step,
      partial_failure: true,
      reason: String(result.reason),
    }));
  } else {
    const fulfilled = result as PromiseFulfilledResult<{ error?: { message: string } }>;
    if (fulfilled.value?.error) {
      console.log(JSON.stringify({
        rid,
        step,
        partial_failure: true,
        db_error: fulfilled.value.error.message,
      }));
    }
  }
}

// ─── メインハンドラ ──────────────────────────────────────
Deno.serve(async (req: Request) => {
  // OPTIONS (CORS preflight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // rid 発行 (リクエスト追跡用)
  const rid = `sig-${crypto.randomUUID().slice(0, 8)}`;

  console.log(JSON.stringify({ rid, step: 'received', method: req.method }));

  // POST のみ受付
  if (req.method !== 'POST') {
    return errorResponse(rid, 'METHOD_NOT_ALLOWED', 405);
  }

  // ─── 1. リクエストボディ取得 ─────────────────────────
  let token: string;
  try {
    const body = await req.json();
    token = body.token;
  } catch (e) {
    return errorResponse(rid, 'INVALID_BODY', 400, String(e));
  }

  if (!token || typeof token !== 'string') {
    return errorResponse(rid, 'INVALID_TOKEN', 401, 'token missing or not string');
  }

  // token識別用ハッシュ (本体は絶対にログ出力しない)
  const tokenHash = await tokenHashPrefix(token);
  console.log(JSON.stringify({
    rid,
    step: 'token_received',
    token_hash_prefix: tokenHash,
    token_length: token.length,
  }));

  // ─── 2. Supabase client (service_role) 生成 ─────────
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse(rid, 'INTERNAL_ERROR', 500, 'env not set');
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // ─── 3. group_sessions 照合 (signage_enabled=true 必須) ───
  const { data: group, error: groupErr } = await supabase
    .from('group_sessions')
    .select('*')
    .eq('signage_token', token)
    .eq('signage_enabled', true)
    .single();

  if (groupErr || !group) {
    return errorResponse(rid, 'INVALID_TOKEN', 401, groupErr?.message || 'group not found');
  }

  console.log(JSON.stringify({
    rid,
    step: 'auth_ok',
    group_id_prefix: String(group.group_id).slice(0, 8),
    facility_id: group.facility_id,
  }));

  // ─── 4. ST版 (SL-) の期限切れチェック ───────────────
  if (group.group_id?.startsWith('SL-') && group.expires_at) {
    if (new Date(group.expires_at) <= new Date()) {
      return errorResponse(rid, 'EXPIRED', 403, 'group expired');
    }
  }

  // ─── 5. messages・handover_notes を並列取得 ─────────
  const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff72h = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();

  const [msgResult, handoverResult] = await Promise.allSettled([
    supabase.from('messages').select('*')
      .eq('group_session_id', group.id)
      .gte('created_at', cutoff60d)
      .order('created_at', { ascending: false }),
    // [E9 案X / EO-DEC-0154] event では handover_notes を空配列で返す（第13章サイネージ側・仕様書22-3）
    //   signage.html は「引き継ぎ0件ならセクションと区切り線を非表示」処理を既に持つため無改修。
    //   safeGroup には期限管理判定に必要な industry のみ追加で返す。
    //   通常グループ（industry !== 'event'）は従来どおり取得する。
    group.industry === 'event'
      ? Promise.resolve({ data: [], error: null })
      : supabase.from('handover_notes').select('*')
          .eq('group_session_id', group.id)
          .gte('created_at', cutoff72h)
          .order('created_at', { ascending: false }),
  ]);

  logPartialFailure(rid, 'messages_fetch', msgResult);
  logPartialFailure(rid, 'handover_notes_fetch', handoverResult);

  const messages = (msgResult.status === 'fulfilled' && !msgResult.value.error)
    ? (msgResult.value.data || []) : [];
  const handoverNotes = (handoverResult.status === 'fulfilled' && !handoverResult.value.error)
    ? (handoverResult.value.data || []) : [];

  // ─── 5-2. 元投稿の補完取得 (第142回 EO-DEC-0142・例外承認) ───────
  // 60日より古い元投稿に返信が付いた場合、元投稿が取得範囲外となるため
  // ID指定で追加取得する。グループ境界は維持し、60日制限は適用しない。
  const rootIds = [...new Set(
    messages
      .filter((m: { root_post_id?: string | null }) => m.root_post_id)
      .map((m: { root_post_id: string }) => m.root_post_id)
  )];
  const missingRootIds = rootIds.filter(
    (id) => !messages.some((m: { id: string }) => m.id === id)
  );

  let mergedMessages = messages;
  if (missingRootIds.length > 0) {
    const { data: extraRoots, error: extraRootsError } = await supabase
      .from('messages')
      .select('*')
      .eq('group_session_id', group.id)   // グループ境界を維持
      .in('id', missingRootIds)            // 60日制限は適用しない
      .is('root_post_id', null);           // 元投稿のみを採用

    if (extraRootsError) {
      // 握り潰さない。既存の統一エラー処理へ流す (第17-4章 条件1・2)
      return errorResponse(rid, 'INTERNAL_ERROR', 500, extraRootsError.message);
    }
    mergedMessages = mergedMessages.concat(extraRoots || []);

    console.log(JSON.stringify({
      rid,
      step: 'root_backfill',
      missing_count: missingRootIds.length,
      fetched_count: (extraRoots || []).length,
    }));
  }

  // ─── 5-3. event の参加取りやめ投稿をプレースホルダー化 ─────────────
  const [withdrawalsResult] = await Promise.allSettled([
    group.industry === 'event'
      ? supabase.from('event_withdrawals').select('eo_uid')
          .eq('group_session_id', group.id)
          .is('released_at', null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  logPartialFailure(rid, 'event_withdrawals_fetch', withdrawalsResult);

  const withdrawnEoUids = (withdrawalsResult.status === 'fulfilled' && !withdrawalsResult.value.error)
    ? (withdrawalsResult.value.data || [])
        .map((row: { eo_uid?: string | null }) => row.eo_uid)
        .filter((eo_uid): eo_uid is string => typeof eo_uid === 'string' && eo_uid.length > 0)
    : [];
  const withdrawnEoUidSet = new Set(withdrawnEoUids);

  const placeholderBody = 'この投稿は表示されません。詳細は主催者へお問い合わせください。';
  mergedMessages = mergedMessages.map((m: Record<string, unknown>) => {
    const senderEoUid = typeof m.sender_eo_uid === 'string' ? m.sender_eo_uid : null;
    if (!senderEoUid || !withdrawnEoUidSet.has(senderEoUid)) {
      return m;
    }
    return {
      ...m,
      body: placeholderBody,
      sender_eo_uid: null,
      priority: 'info',
      image_url: null,
      thumbnail_url: null,
      image_mode: null,
      image_size: null,
      thumbnail_size: null,
      image_uploaded_at: null,
      image_deleted_at: null,
      is_survey: false,
      survey_deadline: null,
    };
  });

  // ─── 6. 既読・確認・メンバー情報・アンケート回答を並列取得 ───────────
  const msgIds = mergedMessages.map((m: { id: string }) => m.id);
  const handoverIds = handoverNotes.map((h: { id: string }) => h.id);
  // アンケート対象メッセージ ID 抽出 (is_survey=true のもののみ)
  const surveyMsgIds = mergedMessages
    .filter((m: { is_survey?: boolean }) => m.is_survey === true)
    .map((m: { id: string }) => m.id);

  const [
    receiptsResult,
    confirmationsResult,
    membersResult,
    allMembersHistResult,
    surveyResponsesResult,
    itemReceiversResult,
  ] = await Promise.allSettled([
    msgIds.length > 0
      ? supabase.from('read_receipts').select('message_id, eo_uid').in('message_id', msgIds)
      : Promise.resolve({ data: [], error: null }),
    handoverIds.length > 0
      ? supabase.from('handover_confirmations').select('handover_id, eo_uid, display_name, action').in('handover_id', handoverIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('group_members').select('eo_uid, display_name, is_signage, created_at')
      .eq('group_session_id', group.id).eq('status', 'approved'),
    supabase.from('group_members').select('eo_uid, created_at, is_signage, display_name')
      .eq('group_session_id', group.id),
    surveyMsgIds.length > 0
      ? supabase.from('message_responses').select('message_id, status').in('message_id', surveyMsgIds)
      : Promise.resolve({ data: [], error: null }),
    // [EO-DEC-0125] item_receivers を対象 messages (msgIds) に限定して取得
    msgIds.length > 0
      ? supabase.from('item_receivers').select('item_id, receiver_eo_uid').eq('item_type', 'message').in('item_id', msgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  logPartialFailure(rid, 'receipts_fetch', receiptsResult);
  logPartialFailure(rid, 'confirmations_fetch', confirmationsResult);
  logPartialFailure(rid, 'members_fetch', membersResult);
  logPartialFailure(rid, 'all_members_hist_fetch', allMembersHistResult);
  logPartialFailure(rid, 'survey_responses_fetch', surveyResponsesResult);
  logPartialFailure(rid, 'item_receivers_fetch', itemReceiversResult);

  const receipts = (receiptsResult.status === 'fulfilled' && !receiptsResult.value.error)
    ? (receiptsResult.value.data || []) : [];
  const confirmations = (confirmationsResult.status === 'fulfilled' && !confirmationsResult.value.error)
    ? (confirmationsResult.value.data || []) : [];
  const members = (membersResult.status === 'fulfilled' && !membersResult.value.error)
    ? (membersResult.value.data || []) : [];
  const allMembersHist = (allMembersHistResult.status === 'fulfilled' && !allMembersHistResult.value.error)
    ? (allMembersHistResult.value.data || []) : [];
  const surveyResponses = (surveyResponsesResult.status === 'fulfilled' && !surveyResponsesResult.value.error)
    ? (surveyResponsesResult.value.data || []) : [];
  const itemReceivers = (itemReceiversResult.status === 'fulfilled' && !itemReceiversResult.value.error)
    ? (itemReceiversResult.value.data || []) : [];

  // ─── 7. レスポンス組み立て (signage_token / signage_enabled は除外: チャッピー修正1) ───
  const safeGroup = {
    id: group.id,
    group_id: group.group_id,
    group_name: group.group_name,
    industry: group.industry,
    facility_id: group.facility_id,
    region: group.region,
    link_url: group.link_url,
    expires_at: group.expires_at,
    created_at: group.created_at,
    // signage_token: 除外 (絶対に返さない)
    // signage_enabled: 除外 (表示制御に不要)
  };

  console.log(JSON.stringify({
    rid,
    step: 'completed',
    msg_count: mergedMessages.length,
    handover_count: handoverNotes.length,
    receipts_count: receipts.length,
    confirmations_count: confirmations.length,
    members_count: members.length,
    survey_responses_count: surveyResponses.length,
    withdrawn_count: withdrawnEoUidSet.size,
  }));

  return jsonResponse({
    ok: true,
    rid,
    group: safeGroup,
    messages: mergedMessages,
    handover_notes: handoverNotes,
    read_receipts: receipts,
    handover_confirmations: confirmations,
    members,
    all_members_hist: allMembersHist,
    survey_responses: surveyResponses,
    item_receivers: itemReceivers,
  }, 200);
});
