// =================================================================
// auth.js - EdgeOps認証フロー独立化
// =================================================================
// チャッピー追加5条件のうち③localStorageキー命名固定を遵守
// チャッピー指摘③Adapter層インターフェース定義を含む
// 作成日: 2026-05-04 (Phase 0 第5章)
// 改修日: 2026-05-13 (Phase D Step 4-B)
// =================================================================
// Phase D Step 4-B 改修内容:
//   - resolveEoUid を line-auth Edge Function 経由に書き換え
//   - prod/staging 環境では Supabase Auth経由JWT発行フローに移行
//   - dev 環境では従来のクライアント側MD5計算を維持(LIFFなしでのテスト用)
//   - clearAuthCache に supabaseClient.auth.signOut() を追加
//   - eo_uid 計算式: CryptoJS.MD5(providerUid + EO_UID_SALT) は維持
//     (チャッピー第7回判定:auth.js generateEoUid() を正本とする)
//
// チャッピー第6回判定反映:旧方式維持・差分最小
// チャッピー第7回判定反映:MD5維持・crypto-js統一・コード=真実 原則
// チャッピー第8回判定反映:環境分岐は最低限・実機E2E可能化
//
// 前提:
//   - window.LINE_AUTH_URL, window.CURRENT_ENV, window.CFG が index.html で定義済
//   - dev 環境では LINE_AUTH_URL があっても呼ばない
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
// 注意:Phase D 後はクライアント側計算は dev 環境のみ使用
// prod/staging では line-auth Edge Function 側で同じ式で計算される
// (Edge Function コード:CryptoJS.MD5 で完全一致・第7回判定確定)
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
//
// Phase D Step 4-B 改修:
//   - prod/staging 環境:line-auth Edge Function 経由でJWT認証
//   - dev 環境:従来通りクライアント側計算(LIFFなしテスト用)
// ─────────────────────────────────────────────
async function resolveEoUid(supabaseClient) {
  if (!supabaseClient) {
    throw new Error('resolveEoUid: supabaseClient is required');
  }

  // 環境判定(index.html で定義された CURRENT_ENV を参照)
  const env = (typeof CURRENT_ENV !== 'undefined') ? CURRENT_ENV : 'prod';
  console.log('[auth.js] resolveEoUid env=', env);

  // ════════════════════════════════════════════
  // dev 環境:従来フロー(クライアント側計算)
  // ════════════════════════════════════════════
  if (env === 'dev') {
    return await resolveEoUidLegacy(supabaseClient);
  }

  // ════════════════════════════════════════════
  // prod/staging 環境:line-auth 経由(Phase D 新フロー)
  // ════════════════════════════════════════════
  return await resolveEoUidViaLineAuth(supabaseClient);
}

// ─────────────────────────────────────────────
// 4-A. 新フロー:line-auth Edge Function 経由
// ─────────────────────────────────────────────
async function resolveEoUidViaLineAuth(supabaseClient) {
  // (a) LIFF id_token 取得
  let id_token;
  try {
    id_token = liff.getIDToken();
    if (!id_token) {
      throw new Error('liff.getIDToken() returned empty');
    }
  } catch (e) {
    console.error('[auth.js] LIFF id_token 取得失敗:', e);
    throw new Error('LIFF id_token unavailable: ' + (e?.message || e));
  }

  // (b) LINEAdapter から displayName / pictureUrl も取得(従来互換)
  const displayName = await currentAdapter.getDisplayName();
  const pictureUrl = await currentAdapter.getPictureUrl();
  const { providerUid } = await currentAdapter.getCurrentUserAuthInfo();

  // (c) localStorageキャッシュ確認(高速化目的・従来互換)
  // 注意:JWT認証は毎回必要なのでキャッシュ判定後も line-auth は呼ぶ
  // ただしキャッシュがあればJWT発行待ちUIが短く感じる(キャッシュは表示用のみ)

  // (d) line-auth Edge Function 呼び出し
  const lineAuthUrl = (typeof LINE_AUTH_URL !== 'undefined') ? LINE_AUTH_URL : null;
  if (!lineAuthUrl) {
    throw new Error('LINE_AUTH_URL is not defined. Check index.html ENV_CONFIG.');
  }

  let lineAuthResult;
  try {
    const res = await fetch(lineAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error('[auth.js] line-auth エラー:', res.status, errBody);
      throw new Error('line-auth failed: HTTP ' + res.status + ' ' + errBody);
    }

    lineAuthResult = await res.json();
  } catch (e) {
    console.error('[auth.js] line-auth fetch 失敗:', e);
    throw new Error('line-auth fetch failed: ' + (e?.message || e));
  }

  const { access_token, refresh_token, eo_uid, rid } = lineAuthResult;
  if (!access_token || !refresh_token || !eo_uid) {
    console.error('[auth.js] line-auth レスポンス不正:', lineAuthResult);
    throw new Error('line-auth invalid response');
  }
  console.log('[auth.js] line-auth ok rid=', rid, 'eo_uid=', eo_uid);

  // (e) Supabase Auth に session をセット(以降のクエリが JWT 付きになる)
  const { error: setSessionErr } = await supabaseClient.auth.setSession({
    access_token,
    refresh_token
  });
  if (setSessionErr) {
    console.error('[auth.js] setSession エラー:', setSessionErr);
    throw new Error('setSession failed: ' + setSessionErr.message);
  }

  // (f) localStorage キャッシュ更新(従来互換)
  localStorage.setItem(LS_KEYS.EO_UID, eo_uid);
  localStorage.setItem(LS_KEYS.PROVIDER, 'line');
  localStorage.setItem(LS_KEYS.PROVIDER_UID, providerUid);

  // (g) users テーブルに display_name を upsert(初回ログイン+表示名更新)
  // Phase D 以降は JWT 認証なので RLS 通過。RLS が is_self() で守る。
  // Hook が JWT に eo_uid claim を載せている前提。
  try {
    await supabaseClient.from('users').upsert(
      { eo_uid, display_name: displayName, language: 'ja' },
      { onConflict: 'eo_uid' }
    );
  } catch (e) {
    // upsert失敗は致命的ではない(既存ユーザーで RLS UPDATE が引っかかる可能性)
    // ログだけ出して継続
    console.warn('[auth.js] users upsert 失敗(継続):', e);
  }

  // (h) 戻り値は従来互換
  return { eoUid: eo_uid, displayName, pictureUrl, providerUid };
}

// ─────────────────────────────────────────────
// 4-B. 旧フロー:クライアント側計算(dev 環境のみ)
// ─────────────────────────────────────────────
// Phase 0 までの実装をそのまま残す
// 注意:RLS が有効な状態(prod/staging Phase D 完了後)では動作しない
//      → だから dev 環境のみで使う
// ─────────────────────────────────────────────
async function resolveEoUidLegacy(supabaseClient) {
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
// Phase D Step 4-B 拡張:Supabase Auth session も明示的に signOut
// ─────────────────────────────────────────────
async function clearAuthCache(supabaseClient) {
  Object.values(LS_KEYS).forEach(key => localStorage.removeItem(key));

  // Phase D 以降は Supabase Auth session も消す
  if (supabaseClient && supabaseClient.auth) {
    try {
      await supabaseClient.auth.signOut();
    } catch (e) {
      console.warn('[auth.js] signOut 失敗(継続):', e);
    }
  }
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
