// supabase/functions/signage-fetch/index.ts
// サイネージ画面用データ取得 Edge Function
// - signage_token によるグループ認証
// - messages（60日）/ handover_notes（72時間）/ read_receipts / handover_confirmations
//   / members / all_members_hist / survey_responses / item_receivers を一括返却
// [実装指示書⑤ / EO-DEC-0125] item_receivers を応答に追加（msgIds に限定）

import { corsHeaders, handlePreflight } from '../_shared/cors.ts';
import { getServiceClient } from '../_shared/auth.ts';
import { generateRequestId } from '../_shared/errors.ts';

const MSG_CUTOFF_DAYS = 60;
const HW_CUTOFF_HOURS = 72;

// ────────────────────────────────────────────
// ヘルパー
// ────────────────────────────────────────────

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function logPartialFailure(rid: string, label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === 'rejected') {
    console.warn(`[${rid}] partial failure: ${label} rejected`, result.reason);
  } else if (
    result.status === 'fulfilled' &&
    (result.value as { error?: unknown })?.error
  ) {
    console.warn(
      `[${rid}] partial failure: ${label} error`,
      (result.value as { error?: unknown }).error,
    );
  }
}

// ────────────────────────────────────────────
// メインハンドラー
// ────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  const rid = generateRequestId();
  const supabase = getServiceClient();

  // ───── リクエストパース ─────
  let token: string | undefined;
  try {
    const body = await req.json();
    token = body?.token;
  } catch {
    return jsonResponse({ ok: false, error_code: 'INVALID_REQUEST' }, 400);
  }

  if (!token) {
    return jsonResponse({ ok: false, error_code: 'INVALID_TOKEN' }, 401);
  }

  // ───── トークン照合 ─────
  const { data: groupSession, error: gsError } = await supabase
    .from('group_sessions')
    .select('*')
    .eq('signage_token', token)
    .maybeSingle();

  if (gsError || !groupSession) {
    return jsonResponse({ ok: false, error_code: 'INVALID_TOKEN' }, 401);
  }

  // signage_enabled が false のときは無効（EXPIRED）
  if (groupSession.signage_enabled === false) {
    return jsonResponse({ ok: false, error_code: 'EXPIRED' }, 403);
  }

  const groupSessionId: string = groupSession.id;

  // safeGroup: signage_token / signage_enabled を除外して返す
  const { signage_token: _st, signage_enabled: _se, ...safeGroup } = groupSession;

  // ───── messages / handover_notes 取得 ─────
  const msgCutoff = new Date(
    Date.now() - MSG_CUTOFF_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const hwCutoff = new Date(
    Date.now() - HW_CUTOFF_HOURS * 60 * 60 * 1000,
  ).toISOString();

  const [messagesRes, handoverRes] = await Promise.all([
    supabase
      .from('messages')
      .select('*')
      .eq('group_session_id', groupSessionId)
      .gte('created_at', msgCutoff)
      .order('created_at', { ascending: false }),
    supabase
      .from('handover_notes')
      .select('*')
      .eq('group_session_id', groupSessionId)
      .gte('created_at', hwCutoff)
      .order('created_at', { ascending: false }),
  ]);

  const messages = messagesRes.data || [];
  const handoverNotes = handoverRes.data || [];

  const msgIds: string[] = messages.map((m: { id: string }) => m.id);
  const handoverIds: string[] = handoverNotes.map((h: { id: string }) => h.id);

  // ───── 関連データを並列取得 ─────
  // 変更①: item_receivers を追加（msgIds に限定・全件取得しない）
  const [
    receiptsResult,
    confirmationsResult,
    membersResult,
    allMembersHistResult,
    surveyResponsesResult,
    itemReceiversResult,   // ← 追加
  ] = await Promise.allSettled([
    msgIds.length > 0
      ? supabase
          .from('read_receipts')
          .select('message_id, eo_uid')
          .in('message_id', msgIds)
      : Promise.resolve({ data: [], error: null }),
    handoverIds.length > 0
      ? supabase
          .from('handover_confirmations')
          .select('*')
          .in('handover_id', handoverIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('group_members')
      .select('*')
      .eq('group_session_id', groupSessionId)
      .eq('status', 'approved'),
    supabase
      .from('group_members')
      .select('eo_uid, is_signage, created_at')
      .eq('group_session_id', groupSessionId),
    msgIds.length > 0
      ? supabase
          .from('survey_responses')
          .select('message_id, status')
          .in('message_id', msgIds)
      : Promise.resolve({ data: [], error: null }),
    msgIds.length > 0
      ? supabase
          .from('item_receivers')
          .select('item_id, receiver_eo_uid')
          .eq('item_type', 'message')
          .in('item_id', msgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  logPartialFailure(rid, 'read_receipts_fetch', receiptsResult);
  logPartialFailure(rid, 'handover_confirmations_fetch', confirmationsResult);
  logPartialFailure(rid, 'members_fetch', membersResult);
  logPartialFailure(rid, 'all_members_hist_fetch', allMembersHistResult);
  logPartialFailure(rid, 'survey_responses_fetch', surveyResponsesResult);
  logPartialFailure(rid, 'item_receivers_fetch', itemReceiversResult);

  // ───── 結果の取り出し ─────
  // 変更②: itemReceivers を取り出す
  const receipts =
    receiptsResult.status === 'fulfilled' && !receiptsResult.value.error
      ? (receiptsResult.value.data || [])
      : [];
  const confirmations =
    confirmationsResult.status === 'fulfilled' && !confirmationsResult.value.error
      ? (confirmationsResult.value.data || [])
      : [];
  const members =
    membersResult.status === 'fulfilled' && !membersResult.value.error
      ? (membersResult.value.data || [])
      : [];
  const allMembersHist =
    allMembersHistResult.status === 'fulfilled' && !allMembersHistResult.value.error
      ? (allMembersHistResult.value.data || [])
      : [];
  const surveyResponses =
    surveyResponsesResult.status === 'fulfilled' && !surveyResponsesResult.value.error
      ? (surveyResponsesResult.value.data || [])
      : [];
  const itemReceivers =
    itemReceiversResult.status === 'fulfilled' && !itemReceiversResult.value.error
      ? (itemReceiversResult.value.data || [])
      : [];

  // ───── 応答 ─────
  // 変更③: item_receivers を応答に追加
  return jsonResponse(
    {
      ok: true,
      rid,
      group: safeGroup,
      messages,
      handover_notes: handoverNotes,
      read_receipts: receipts,
      handover_confirmations: confirmations,
      members,
      all_members_hist: allMembersHist,
      survey_responses: surveyResponses,
      item_receivers: itemReceivers,   // ← 追加
    },
    200,
  );
});
