// =================================================================
// auth.js - EdgeOps認証フロー独立化 (Phase 0)
// =================================================================
// チャッピー追加5条件のうち③localStorageキー命名固定を遵守
// チャッピー指摘③Adapter層インターフェース定義を含む
// 作成日: 2026-05-04 (Phase 0 第5章)
// =================================================================

// ─────────────────────────────────────────────
// 1. localStorageキー定数(★edgeops_*プレフィックス統一)
// ─────────────────────────────────────────────
const LS_KEYS = {
  EO_UID: 'edgeops_eo_uid',
  PROVIDER: 'edgeops_provider',
  PROVIDER_UID: 'edgeops_provider_uid',
  GROUP_SESSION_ID: 'edgeops_group_session_id',
  CURRENT_GROUP_ID: 'edgeops_current_group_id',
  FACILITY_ID: 'edgeops_facility_id',
  LANGUAGE: 'edgeops_language',
  SIGNAGE_TOKEN: 'edgeops_signage_token'
};

// ─────────────────────────────────────────────
// 2. MessagingAdapter インターフェース(チャッピー指摘③)
// ─────────────────────────────────────────────
// 将来的にPhase 1でLINEAdapter / KakaoAdapter等を実装する
// Phase 0ではLINEAdapterのみ
// ─────────────────────────────────────────────
const LINEAdapter = {
  async getCurrentUserAuthInfo() {
    const profile = await liff.getProfile();
    return { provider: 'line', providerUid: profile.userId };
  },
  async getDisplayName() {
    const profile = await liff.getProfile();
    return profile.displayName;
  },
  async getPictureUrl() {
    try {
      const profile = await liff.getProfile();
      return profile.pictureUrl || '';
    } catch (e) {
      return '';
    }
  },
  openExternalUrl(url) {
    if (liff.isInClient()) {
      liff.openWindow({ url, external: true });
    } else {
      window.open(url, '_blank');
    }
  }
};

// 現在のAdapter(Phase 0では常にLINE)
const currentAdapter = LINEAdapter;

// ─────────────────────────────────────────────
// 3. eo_uid生成(salt値「edgeops_v1_2026」は絶対に変更しない)
// ─────────────────────────────────────────────
const EO_UID_SALT = 'edgeops_v1_2026';

function generateEoUid(providerUid) {
  if (typeof CryptoJS === 'undefined') {
    throw new Error('CryptoJS is not loaded. crypto-js CDN must be included before auth.js');
  }
  const md5 = CryptoJS.MD5(providerUid + EO_UID_SALT).toString();
  return 'EU-' + md5.substring(0, 8).toUpperCase();
}

// ─────────────────────────────────────────────
// 4. eo_uid解決(認証フローの中核)
// ─────────────────────────────────────────────
// 引数:
//   supabaseClient - 呼び出し元のSupabaseクライアントインスタンス
// 戻り値:
//   { eoUid, displayName, pictureUrl, providerUid }
// ─────────────────────────────────────────────
async function resolveEoUid(supabaseClient) {
  if (!supabaseClient) {
    throw new Error('resolveEoUid: supabaseClient is required');
  }

  // (a) Adapterから現在の認証情報を取得
  const { provider, providerUid } = await currentAdapter.getCurrentUserAuthInfo();
  const displayName = await currentAdapter.getDisplayName();
  const pictureUrl = await currentAdapter.getPictureUrl();

  // (b) LocalStorageキャッシュ確認(同一providerUidの場合のみ高速化)
  const cachedEoUid = localStorage.getItem(LS_KEYS.EO_UID);
  const cachedProviderUid = localStorage.getItem(LS_KEYS.PROVIDER_UID);
  if (cachedEoUid && cachedProviderUid === providerUid) {
    return { eoUid: cachedEoUid, displayName, pictureUrl, providerUid };
  }

  // (c) user_auth_providersから既存レコード検索
  const { data: existing, error: selectError } = await supabaseClient
    .from('user_auth_providers')
    .select('eo_uid')
    .eq('provider', provider)
    .eq('provider_uid', providerUid)
    .maybeSingle();

  if (selectError) {
    console.error('[auth.js] user_auth_providers 検索エラー:', selectError);
  }

  if (existing) {
    localStorage.setItem(LS_KEYS.EO_UID, existing.eo_uid);
    localStorage.setItem(LS_KEYS.PROVIDER, provider);
    localStorage.setItem(LS_KEYS.PROVIDER_UID, providerUid);
    return { eoUid: existing.eo_uid, displayName, pictureUrl, providerUid };
  }

  // (d) 既存なし=初回ログイン:eo_uid生成+users+user_auth_providers作成
  const eoUid = generateEoUid(providerUid);

  const { error: usersErr } = await supabaseClient.from('users').insert({
    eo_uid: eoUid,
    display_name: displayName,
    language: 'ja'
  });
  if (usersErr) {
    console.error('[auth.js] users INSERT エラー:', usersErr);
    throw usersErr;
  }

  const { error: authErr } = await supabaseClient.from('user_auth_providers').insert({
    eo_uid: eoUid,
    provider: provider,
    provider_uid: providerUid,
    is_primary: true
  });
  if (authErr) {
    console.error('[auth.js] user_auth_providers INSERT エラー:', authErr);
    throw authErr;
  }

  localStorage.setItem(LS_KEYS.EO_UID, eoUid);
  localStorage.setItem(LS_KEYS.PROVIDER, provider);
  localStorage.setItem(LS_KEYS.PROVIDER_UID, providerUid);

  return { eoUid, displayName, pictureUrl, providerUid };
}

// ─────────────────────────────────────────────
// 5. 超管理者判定
// ─────────────────────────────────────────────
async function isAdmin(supabaseClient, eoUid) {
  if (!supabaseClient || !eoUid) return false;
  const { data } = await supabaseClient
    .from('admins')
    .select('eo_uid')
    .eq('eo_uid', eoUid)
    .maybeSingle();
  return !!data;
}

// ─────────────────────────────────────────────
// 6. 認証クリア(ログアウト時)
// ─────────────────────────────────────────────
function clearAuthCache() {
  Object.values(LS_KEYS).forEach(key => localStorage.removeItem(key));
}

// ─────────────────────────────────────────────
// 7. 開発モード用 eo_uid 生成(LIFFが使えないブラウザテスト時)
// ─────────────────────────────────────────────
function generateDevEoUid() {
  const devProviderUid = 'dev_' + Math.random().toString(36).substr(2, 9);
  const eoUid = generateEoUid(devProviderUid);
  return { eoUid, providerUid: devProviderUid };
}

// ─────────────────────────────────────────────
// 8. 現在のユーザーの所属施設取得(Phase 0 Step 4 追加・2026/5/5)
// ─────────────────────────────────────────────
// 引数:
//   supabaseClient - Supabaseクライアント
//   eoUid - 取得対象のEdgeOps UID
// 戻り値:
//   { facilityUuid, facilityCode, plan, isMain } または null
// 用途:
//   Phase 1 manager.html での施設フィルタ・UI出し分けに使用
// NOTE: 将来マルチ施設対応時は配列返却に変更する可能性あり(チャッピー指摘)
// ─────────────────────────────────────────────
async function getCurrentFacility(supabaseClient, eoUid) {
  if (!supabaseClient || !eoUid) return null;
  
  // facility_managers から所属施設を JOIN で取得
  const { data, error } = await supabaseClient
    .from('facility_managers')
    .select(`
      facility_id,
      is_main,
      status,
      facilities (
        id,
        facility_code,
        plan
      )
    `)
    .eq('eo_uid', eoUid)
    .eq('status', 'active')
    .maybeSingle();
  
  if (error) {
    console.error('[auth.js] getCurrentFacility エラー:', error);
    return null;
  }
  
  if (!data || !data.facilities) return null;
  
  return {
    facilityUuid: data.facilities.id,
    facilityCode: data.facilities.facility_code,
    plan: data.facilities.plan,
    isMain: data.is_main
  };
}

// ─────────────────────────────────────────────
// 9. 現在のユーザーのロール判定(Phase 0 Step 4 追加・2026/5/5)
// ─────────────────────────────────────────────
// 引数:
//   supabaseClient - Supabaseクライアント
//   eoUid - 判定対象のEdgeOps UID
//   groupSessionId - グループセッションID(省略可・グループ管理者判定用)
// 戻り値:
//   'super_admin' / 'facility_main' / 'facility_sub' /
//   'group_manager' / 'member' / 'unknown'
// 優先順位:
//   super_admin > facility_main/sub > group_manager > member > unknown
// 用途:
//   Phase 1 manager.html で getCurrentRole() を使ってUI出し分け・施設フィルタを実現
// NOTE: 将来「複合ロール」対応(super_admin かつ facility_main 等)が必要になった
//       場合は、戻り値をオブジェクト({isSuperAdmin, isFacilityMain, ...})に拡張する
//       予定(Phase 1.5以降想定・チャッピー指摘)
// ─────────────────────────────────────────────
async function getCurrentRole(supabaseClient, eoUid, groupSessionId = null) {
  if (!supabaseClient || !eoUid) return 'unknown';
  
  // ① 超管理者チェック(adminsテーブル)
  // NOTE: adminsにstatusカラム追加時はここで絞り込みを追加する(チャッピー指摘)
  const { data: admin } = await supabaseClient
    .from('admins')
    .select('eo_uid')
    .eq('eo_uid', eoUid)
    .maybeSingle();
  if (admin) return 'super_admin';
  
  // ② 施設管理者チェック(facility_managers テーブル)
  const { data: fm } = await supabaseClient
    .from('facility_managers')
    .select('is_main, status')
    .eq('eo_uid', eoUid)
    .eq('status', 'active')
    .maybeSingle();
  if (fm) {
    return fm.is_main ? 'facility_main' : 'facility_sub';
  }
  
  // ③ グループ管理者チェック(group_session_id 指定がある場合のみ)
  if (groupSessionId) {
    const { data: gm } = await supabaseClient
      .from('group_members')
      .select('is_creator, status')
      .eq('eo_uid', eoUid)
      .eq('group_session_id', groupSessionId)
      .eq('status', 'approved')
      .maybeSingle();
    if (gm) {
      return gm.is_creator ? 'group_manager' : 'member';
    }
  }
  
  // ④ どこにも所属なし
  return 'unknown';
}

// ─────────────────────────────────────────────
// 10. 監査ログ記録(Phase 0 Step 4 追加・Phase 1 で利用開始・2026/5/5)
// ─────────────────────────────────────────────
// 引数:
//   supabaseClient - Supabaseクライアント
//   params: {
//     facilityId,        // UUID(省略可・null許容)
//     actorEoUid,        // 操作者の eo_uid (必須)
//     actorRole,         // 'super_admin' / 'facility_main' / 'facility_sub' /
//                        // 'group_manager' / 'member'
//     action,            // 'create' / 'update' / 'delete' / 'login' / 'export' (必須)
//     targetType,        // 'facility' / 'member' / 'group' / 'message' / 'subscription' 等
//     targetId,          // 操作対象のID
//     beforeState,       // 変更前(JSONB) - 省略可
//     afterState         // 変更後(JSONB) - 省略可
//   }
// 戻り値:
//   { success: true, id } または { success: false, error }
// 設計方針:
//   ★ログ書き込み失敗時もユーザー操作は止めない(監査ログは補助機能であり、
//     本機能停止はアンチパターン・チャッピー承認済)
//   ★console.error でログ出力するが throw はしない
// TODO: Phase 2で監視/アラート連携(チャッピー指摘)
// ─────────────────────────────────────────────
async function auditLog(supabaseClient, params) {
  if (!supabaseClient || !params || !params.actorEoUid || !params.action) {
    console.warn('[auth.js] auditLog: 必須パラメータ不足', params);
    return { success: false, error: 'invalid params' };
  }
  
  const { data, error } = await supabaseClient
    .from('audit_logs')
    .insert({
      facility_id: params.facilityId || null,
      actor_eo_uid: params.actorEoUid,
      actor_role: params.actorRole || null,
      action: params.action,
      target_type: params.targetType || null,
      target_id: params.targetId || null,
      before_state: params.beforeState || null,
      after_state: params.afterState || null
    })
    .select('id')
    .single();
  
  if (error) {
    console.error('[auth.js] auditLog INSERT エラー:', error);
    return { success: false, error };
  }
  
  return { success: true, id: data.id };
}
