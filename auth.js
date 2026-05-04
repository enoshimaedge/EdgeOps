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
