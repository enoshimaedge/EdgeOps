// ═══════════════════════════════════════════
// [Phase 4-2A] クライアント画像圧縮ヘルパー
// ═══════════════════════════════════════════
// チャッピー第49回判定(III): Main thread + 処理中モーダル(WebWorkerはPro版以降)
// 仕様書 v2.5 5-4 準拠 → 第122回判定(EO-DEC-0122・条件付きGO・案B)でフル画像を引き上げ:
//   フル 1920px品質80% → 2240px品質88% + サムネ400px品質70%(据え置き)
//   実写換算で1枚あたり約500KB → 約900KB(約2倍・許容範囲)。サムネ・5MB安全弁・DB/RPC/EFは不変更。
// 出力5MB超過時は SIZE_OVER_5MB エラー
// ═══════════════════════════════════════════
const IMAGE_MAX_DIMENSION_FULL = 2240;
const IMAGE_MAX_DIMENSION_THUMB = 400;
const IMAGE_QUALITY_FULL = 0.88;
const IMAGE_QUALITY_THUMB = 0.7;
const IMAGE_MAX_OUTPUT_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

function _loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    let objectUrl = null;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch (_) {
      reject(new Error('IMAGE_LOAD_FAILED'));
      return;
    }
    const img = new Image();
    img.onload = () => resolve({ img: img, objectUrl: objectUrl });
    img.onerror = () => {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      reject(new Error('IMAGE_LOAD_FAILED'));
    };
    img.src = objectUrl;
  });
}

function _drawToJpegBlob(img, maxDim, quality) {
  return new Promise((resolve, reject) => {
    try {
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) { reject(new Error('CANVAS_FAILED')); return; }
      let cw = w, ch = h;
      if (w > maxDim || h > maxDim) {
        if (w >= h) { cw = maxDim; ch = Math.max(1, Math.round(h * maxDim / w)); }
        else { ch = maxDim; cw = Math.max(1, Math.round(w * maxDim / h)); }
      }
      const canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('CANVAS_FAILED')); return; }
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, cw, ch);
      ctx.drawImage(img, 0, 0, cw, ch);
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('CANVAS_FAILED')); return; }
        resolve(blob);
      }, 'image/jpeg', quality);
    } catch (e) {
      reject(new Error('CANVAS_FAILED'));
    }
  });
}

// 戻り値: { fullBlob, thumbBlob, fullSize, thumbSize, width, height }
// 例外: INVALID_MIME / HEIC_UNSUPPORTED / IMAGE_LOAD_FAILED / CANVAS_FAILED / SIZE_OVER_5MB
async function compressImageForUpload(file) {
  if (!file) throw new Error('INVALID_MIME');

  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();

  // [チャッピー第52回判定 修正3] HEIC/HEIF を明示拒否(MIME・拡張子の両方で判定)
  // iPhone標準のHEIC撮影をスクショ案内で誘導(仕様書v2.5 第14章 項目13・第5章5-3に整合)
  const isHeic =
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    name.endsWith('.heic') ||
    name.endsWith('.heif');
  if (isHeic) {
    throw new Error('HEIC_UNSUPPORTED');
  }

  // 仕様書v2.5 5-3(改): JPEG / PNG / WebP のみ対応(HEIC/HEIF は撤回・拒否)
  const allowed =
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp');
  if (!allowed) {
    throw new Error('INVALID_MIME');
  }

  let loaded = null;
  try {
    loaded = await _loadImageFromFile(file);
    const fullBlob = await _drawToJpegBlob(loaded.img, IMAGE_MAX_DIMENSION_FULL, IMAGE_QUALITY_FULL);
    const thumbBlob = await _drawToJpegBlob(loaded.img, IMAGE_MAX_DIMENSION_THUMB, IMAGE_QUALITY_THUMB);
    if (fullBlob.size > IMAGE_MAX_OUTPUT_SIZE_BYTES) {
      throw new Error('SIZE_OVER_5MB');
    }
    return {
      fullBlob: fullBlob,
      thumbBlob: thumbBlob,
      fullSize: fullBlob.size,
      thumbSize: thumbBlob.size,
      width: loaded.img.naturalWidth || loaded.img.width,
      height: loaded.img.naturalHeight || loaded.img.height
    };
  } finally {
    if (loaded && loaded.objectUrl) {
      try { URL.revokeObjectURL(loaded.objectUrl); } catch (_) {}
    }
  }
}

// ═══════════════════════════════════════════
// [Phase 4-2C/D] 画像投稿UI状態管理(ボタン表示・選択ファイル保持)
// ═══════════════════════════════════════════
// __pendingImageFile: 選択中のFile(送信時にcompressImageForUpload→sendImageMessageへ)
// Phase 4-2E sendImageMessage() が参照する。本Phase(4-2A〜D)では送信側は未実装。
// ═══════════════════════════════════════════
window.__pendingImageFile = null;
let __imageProcessingModalShown = false;


function _showImageProcessingModal(show) {
  const modal = document.getElementById('image-processing-modal');
  if (!modal) return;
  modal.style.display = show ? 'flex' : 'none';
  __imageProcessingModalShown = !!show;
  // 送信ボタンの二重押下防止
  const sendBtn = document.getElementById('compose-send-btn');
  if (sendBtn) sendBtn.disabled = !!show;
}

// ═══════════════════════════════════════════
// [チャッピー第107/108回判定] 遅延ローディング共通ヘルパー
//   - 投稿処理が800msを超えた時だけ既存オーバーレイを表示(チラつき防止)
//   - 速い投稿では一度も表示しない
//   - 成功/失敗/例外いずれの終了経路でも .stop() で必ずタイマー解除+非表示
//   - 署名URL/Edge Function/DB/認証には一切非接触(待ち時間の見せ方のみ)
//   - 送信ボタンのdisabledは各投稿経路の既存処理に委ね、本ヘルパーでは触らない
// ═══════════════════════════════════════════
const LOADING_DELAY_MS = 800; // チャッピー第108回推奨しきい値
function startDelayedLoading(title, sub) {
  let shown = false;
  const timer = setTimeout(() => {
    const modal = document.getElementById('image-processing-modal');
    if (!modal) return;
    const titleEl = document.getElementById('image-processing-modal-title');
    const subEl = document.getElementById('image-processing-modal-sub');
    if (titleEl) titleEl.textContent = title || '送信中…';
    if (subEl) subEl.textContent = sub || '通信状況により数秒かかる場合があります';
    modal.style.display = 'flex';
    __imageProcessingModalShown = true;
    shown = true;
  }, LOADING_DELAY_MS);

  return {
    stop() {
      clearTimeout(timer);
      if (shown) {
        const modal = document.getElementById('image-processing-modal');
        if (modal) modal.style.display = 'none';
        __imageProcessingModalShown = false;
        shown = false;
      }
    }
  };
}

function _resetPendingImage() {
  window.__pendingImageFile = null;
  const previewWrap = document.getElementById('compose-image-preview-wrap');
  const previewImg = document.getElementById('compose-image-preview-img');
  if (previewImg) {
    if (previewImg.src && previewImg.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(previewImg.src); } catch (_) {}
    }
    previewImg.src = '';
  }
  if (previewWrap) previewWrap.style.display = 'none';
  // [②Androidカメラ起動対策・チャッピー第59-2回判定/2026-05-18] 両 file input をリセット
  const fileInputCamera = document.getElementById('compose-image-file-camera');
  if (fileInputCamera) fileInputCamera.value = '';
  const fileInputLibrary = document.getElementById('compose-image-file-library');
  if (fileInputLibrary) fileInputLibrary.value = '';
}

// [②Androidカメラ起動対策・チャッピー第59-2回判定 GO/2026-05-18]
// カメラ専用ボタン押下:capture="environment" 付き input をトリガー
// 同期処理のみ・await を挟まない(iOS Safari WebViewのユーザージェスチャー連鎖維持)
// 残量チェック・isCreator確認・MIMEチェックは onComposeImageFileSelected 側で実施
function onComposeImageButtonClickCamera() {
  const fileInput = document.getElementById('compose-image-file-camera');
  if (fileInput) fileInput.click();
}

// ライブラリ専用ボタン押下:capture 属性なし input をトリガー(現状挙動継承)
function onComposeImageButtonClickLibrary() {
  const fileInput = document.getElementById('compose-image-file-library');
  if (fileInput) fileInput.click();
}

async function onComposeImageFileSelected(ev) {
  const file = ev && ev.target && ev.target.files && ev.target.files[0];
  if (!file) return;
  // [⑫クォータ表示UI・チャッピー第58回判定 条件7・iPhone Safari対策/2026-05-18]
  // ファイル選択直後に残量再確認(ボタン押下時にチェックすると iOS Safari でジェスチャー連鎖が切れるため)
  try {
    const quotaCtx = (typeof selectedComposeType === 'string' && selectedComposeType === 'handover') ? 'handover' : 'message';
    const { remaining, limit } = await getRemainingQuota(quotaCtx);
    if (remaining <= 0) {
      showToast(`本日の画像投稿上限(${limit}回)に達しました。明日までお待ちください`);
      try { updateImageQuotaUI(); } catch (_) {}
      // ファイル選択をクリア(同じファイルを連続選択できるようにするため)
      try { ev.target.value = ''; } catch (_) {}
      return;
    }
  } catch (_) { /* 取得失敗時はサーバ側 QUOTA_EXCEEDED に任せる */ }
  // 二重選択防止
  if (__imageProcessingModalShown) return;
  // 圧縮前のバリデーション(MIME・サイズの最低限チェック)
  if (!file.type || !file.type.startsWith('image/')) {
    showToast('画像ファイルを選択してください');
    return;
  }
  // 起動時キャッシュではなく、選択時点でcontext別フラグを軽く再確認(キャッシュ許容)
  const flags = await getFeatureFlags(false);
  const ctx = (typeof selectedComposeType === 'string') ? selectedComposeType : 'msg';
  if (!flags.image_upload || (ctx === 'msg' && !flags.image_upload_message) || (ctx === 'handover' && !flags.image_upload_handover)) {
    showToast('画像投稿は現在利用できません');
    applyImageUploadButtonVisibility();
    return;
  }
  // 圧縮中モーダル表示(チャッピー条件: Main thread + 処理中モーダル)
  _showImageProcessingModal(true);
  try {
    const result = await compressImageForUpload(file);
    // プレビューはサムネを使う(メモリ節約)
    const previewWrap = document.getElementById('compose-image-preview-wrap');
    const previewImg = document.getElementById('compose-image-preview-img');
    const previewInfo = document.getElementById('compose-image-preview-info');
    if (previewImg) {
      if (previewImg.src && previewImg.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(previewImg.src); } catch (_) {}
      }
      previewImg.src = URL.createObjectURL(result.thumbBlob);
    }
    if (previewInfo) {
      const kb = Math.round(result.fullSize / 1024);
      previewInfo.textContent = `画像準備完了 / ${result.width}×${result.height} / ${kb}KB`;
    }
    if (previewWrap) previewWrap.style.display = 'block';
    // 送信時の本体は元File(sendImageMessage側で再圧縮 or 圧縮済Blobを引き渡し)
    // Phase 4-2E実装時に圧縮結果を直接渡す形に変更可能(現状は元Fileを保持し再圧縮も許容)
    window.__pendingImageFile = file;
    window.__pendingImageCompressed = result; // 圧縮結果をキャッシュ(4-2Eで使用)
  } catch (e) {
    const code = (e && e.message) || 'UNKNOWN';
    let msg = '画像の処理に失敗しました';
    if (code === 'INVALID_MIME') msg = '画像ファイルを選択してください(JPEG・PNG・WebP形式)';
    else if (code === 'HEIC_UNSUPPORTED') msg = 'HEIC形式には対応していません。スクリーンショットを撮るか、JPEG・PNG・WebP形式の画像を選んでください';
    else if (code === 'IMAGE_LOAD_FAILED') msg = '画像を読み込めませんでした';
    else if (code === 'CANVAS_FAILED') msg = '画像の変換に失敗しました。JPEG・PNG・WebP形式の画像を選んでください';
    else if (code === 'SIZE_OVER_5MB') msg = '画像サイズが大きすぎます(5MB超)。別の画像を選んでください';
    showToast(msg);
    _resetPendingImage();
    console.error('[Phase 4-2A] 圧縮失敗:', code, e);
  } finally {
    _showImageProcessingModal(false);
  }
}

function onComposeImageCancel() {
  // プレビュー横の✕ボタン: 選択画像をクリア
  _resetPendingImage();
}

// ═══════════════════════════════════════════
// [Phase 4-2E] 画像投稿送信フロー sendImageMessage()
// ═══════════════════════════════════════════
// チャッピー第49回判定の必須条件:
//   (I) sendMessage既存本体は触らず冒頭に分岐ガードのみ追加 → 済
//   (II) 送信直前にfeature_flags再確認 (isImageUploadAllowedForContext)
//   (III) Main thread + 処理中モーダル (再圧縮時のみ表示)
//   (V) 失敗時は本文・画像プレビューを入力欄に残す(画像由来エラーのみ画像クリア)
//   sendImageMessage失敗時に通常sendMessageへ「フォールバックしない」(事故防止)
// upload-image Edge Function (auth.js window.callImageFunction 経由・Authorization自動付与)
// ═══════════════════════════════════════════
async function sendImageMessage() {
  await assertLiffEnvironment();
  // [2026/5/23 案B] リロード耐性ガード(チャッピー第72回判定GO)
  const u = await ensureCurrentUser();
  if (!u) { showToast('認証エラーです。アプリを再起動してください。'); return; }
  const body = document.getElementById('compose-body').value.trim();

  // [チャッピー第54回判定 GO] ⑦アンケート画像ガード:アンケート選択時は画像送信不可
  // context = 'message'(連絡)時のみ survey-checkbox を確認
  const composeContextType = (typeof selectedComposeType === 'string' && selectedComposeType === 'handover') ? 'handover' : 'message';
  if (composeContextType === 'message') {
    const surveyCb = document.getElementById('survey-checkbox');
    if (surveyCb && surveyCb.checked === true) {
      showToast('アンケートでは画像を添付できません');
      return;
    }
  }

  // ガード: 画像が選択されていない場合は通常フローへ戻す(理論上は呼ばれない)
  if (!window.__pendingImageFile) {
    showToast('画像が選択されていません');
    return;
  }

  // [チャッピー第53回判定 修正] 本文必須(Edge Function側でmetadata.body空NGのため)
  if (!body) {
    showToast('本文を入力してください(画像投稿には本文が必要です)');
    return;
  }

  // context判定(現在のcompose種別)
  const context = (typeof selectedComposeType === 'string' && selectedComposeType === 'handover') ? 'handover' : 'message';

  // [チャッピー条件II] 送信直前にfeature_flagsを強制再取得(緊急OFF即時反映)
  let allowed = false;
  try {
    allowed = await isImageUploadAllowedForContext(context);
  } catch (_) { allowed = false; }
  if (!allowed) {
    showToast('画像投稿は現在利用できません');
    try { applyImageUploadButtonVisibility(); } catch (_) {}
    return;
  }

  // 圧縮結果を取得(4-2Aで選択時にキャッシュ済)
  let compressed = window.__pendingImageCompressed;
  if (!compressed) {
    // 念のため再圧縮(通常はあり得ない・キャッシュ消失時のみ)
    _showImageProcessingModal(true);
    try {
      compressed = await compressImageForUpload(window.__pendingImageFile);
      window.__pendingImageCompressed = compressed;
    } catch (e) {
      _showImageProcessingModal(false);
      const code = (e && e.message) || 'UNKNOWN';
      if (code === 'SIZE_OVER_5MB') showToast('画像サイズが大きすぎます。別の画像を選んでください');
      else if (code === 'HEIC_UNSUPPORTED') showToast('HEIC形式には対応していません。スクリーンショットを撮るか、JPEG・PNG・WebP形式の画像を選んでください');
      else if (code === 'INVALID_MIME') showToast('画像ファイルを選択してください(JPEG・PNG・WebP形式)');
      else if (code === 'CANVAS_FAILED') showToast('画像の変換に失敗しました。JPEG・PNG・WebP形式の画像を選んでください');
      else showToast('画像の処理に失敗しました');
      // 画像由来エラー: 画像はクリアするが本文は残す
      _resetPendingImage();
      console.error('[Phase 4-2E] 再圧縮失敗:', code, e);
      return;
    }
    _showImageProcessingModal(false);
  }

  // 送信ボタン disable(二重送信防止)
  const sendBtn = document.getElementById('compose-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  // [第107/108回] 800ms超で処理中表示(画像は通常超えるためほぼ常時表示)
  const __loading = startDelayedLoading('画像を送信中…', '通信状況により数秒かかる場合があります');

  try {
    showToast('画像を送信中...');

    // [チャッピー第53回判定 修正] Edge Function (upload-image) 仕様準拠
    // metadata(JSON文字列)+ fullImage(File)+ thumbnail(File) の3フィールドのみ
    // sender_eo_uid/sender_name/priority/receiver_count等はEdge Function側で取得or不使用
    const metadata = {
      body: body,
      group_session_id: String(currentGroup?.id || ''),
      context: context, // 'message' | 'handover'
      priority: (context === 'handover') ? selectedHandoverPriority : selectedPriority, // [2026/6/15] 画像付きでも優先度を保存
      image_mode: 'expandable' // ST版デフォルト(タップで全画面拡大)
    };

    const fd = new FormData();
    fd.append('metadata', JSON.stringify(metadata));
    fd.append('fullImage', compressed.fullBlob, 'image_full.jpg');
    fd.append('thumbnail', compressed.thumbBlob, 'image_thumb.jpg');

    // auth.js の callImageFunction 経由(Authorization自動付与・401自動リトライ)
    const url = `${SUPABASE_URL}/functions/v1/upload-image`;
    if (typeof window.callImageFunction !== 'function') {
      throw new Error('AUTH_HELPER_MISSING');
    }
    const res = await window.callImageFunction(url, { method: 'POST', body: fd });

    if (!res || !res.ok) {
      // エラーコード抽出(Edge Function 応答仕様 v2.4)
      let errorCode = 'SERVER_ERROR';
      try {
        const errBody = await res.text();
        if (errBody) {
          try {
            const errJson = JSON.parse(errBody);
            errorCode = errJson.error || errJson.code || `HTTP_${res.status}`;
          } catch (_) {
            errorCode = `HTTP_${res.status}`;
          }
        } else {
          errorCode = `HTTP_${res.status}`;
        }
      } catch (_) { errorCode = `HTTP_${(res && res.status) || 'UNKNOWN'}`; }
      throw new Error(errorCode);
    }

    // ───── 成功時: 既存sendMessageと同じ後処理 ─────
    document.getElementById('compose-body').value = '';
    _resetPendingImage();

    if (context === 'message') {
      selectedPriority = 'info';
      selectPriority('info');
      // アンケートUIリセット(既存sendMessageと同じ)
      const surveyCb = document.getElementById('survey-checkbox');
      if (surveyCb) surveyCb.checked = false;
      const dlWrap = document.getElementById('survey-deadline-wrap');
      if (dlWrap) dlWrap.style.display = 'none';
      const dlInput = document.getElementById('survey-deadline-input');
      if (dlInput) dlInput.value = '';
    } else {
      selectedComposeType = 'msg';
    }

    await loadMessages();
    // [チャッピー第60-3回判定 GO] 引き継ぎ投稿後の遷移バグ修正
    // context に応じて適切なタブをアクティブにする(setHomeFilterは内部でloadMessagesを呼ばないため二重ロードなし)
    if (context === 'handover') {
      await setHomeFilter('handover');
    } else {
      await setHomeFilter('msg');
    }
    showScreen('screen-home');
    showToast(context === 'handover' ? '引き継ぎを投稿しました！' : '送信しました！');
    // [⑫クォータ表示UI・チャッピー第58回判定 条件4] 投稿成功後にクォータUI更新(次回compose画面表示時に最新値で表示)
    try { updateImageQuotaUI(); } catch (_) {}

  } catch (e) {
    // ───── [チャッピー条件V] 失敗時は本文・画像プレビューを残す ─────
    const code = (e && e.message) || 'UNKNOWN_ERROR';
    let msg = '送信に失敗しました';
    let resetImage = false; // 画像由来エラーのみ画像クリア

    if (code === 'SIZE_OVER_5MB' || code === 'INVALID_MIME' || code === 'CANVAS_FAILED') {
      msg = '画像に問題があります。別の画像を選んでください';
      resetImage = true;
    } else if (code === 'QUOTA_EXCEEDED') {
      msg = '本日の画像投稿上限に達しました。明日までお待ちください';
    } else if (code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED' || code === 'AUTH_TOKEN_MISSING') {
      msg = '認証エラー。LINEを開き直してください';
    } else if (code === 'FEATURE_DISABLED' || code === 'IMAGE_UPLOAD_DISABLED') {
      msg = '画像投稿は現在利用できません';
      resetImage = true;
    } else if (code === 'AUTH_HELPER_MISSING') {
      msg = '内部エラー(auth helper)。LINEを開き直してください';
    } else if (code === 'NETWORK_ERROR' || code.startsWith('HTTP_5') || code === 'SERVER_ERROR') {
      msg = '通信エラー。もう一度お試しください';
    } else if (code.startsWith('HTTP_4')) {
      msg = 'リクエストエラー。内容を確認してください';
    }

    showToast(msg);
    if (resetImage) {
      _resetPendingImage();
    }
    // ★ 重要: 本文は document.getElementById('compose-body').value をクリアしない
    //         画像プレビュー(resetImage=false時)も保持 → 再送信可能
    //         通常sendMessageへのフォールバックは絶対に「しない」
    console.error('[Phase 4-2E] 画像送信失敗:', code, e);
  } finally {
    __loading.stop();
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ═══════════════════════════════════════════
// [Phase 4-2F] サムネ表示・Lazy load (IntersectionObserver + 署名URLキャッシュ)
// ═══════════════════════════════════════════
// チャッピー第49回判定条件(IV):
//   - 画面に入った画像だけ署名URLを取得 (IntersectionObserver)
//   - Mapで55分キャッシュ (Supabase signed URLの有効期限60分より短く)
//   - Promise同時発行最大5件
//   - localStorage保存禁止 (memory only)・consoleにtoken/署名URL出さない
// ═══════════════════════════════════════════
const __signedUrlCache = new Map(); // key: storage_path, value: { url, expiresAt }
const SIGNED_URL_CACHE_TTL_MS = 55 * 60 * 1000; // 55分
const SIGNED_URL_MAX_CONCURRENT = 5;
let __signedUrlInflight = 0;
const __signedUrlWaitQueue = [];
let __imageThumbObserver = null;

// 同時発行制限付きシリアライザ(チャッピー条件IV)
function _acquireSignedUrlSlot() {
  return new Promise(resolve => {
    if (__signedUrlInflight < SIGNED_URL_MAX_CONCURRENT) {
      __signedUrlInflight++;
      resolve();
    } else {
      __signedUrlWaitQueue.push(resolve);
    }
  });
}
function _releaseSignedUrlSlot() {
  __signedUrlInflight--;
  const next = __signedUrlWaitQueue.shift();
  if (next) { __signedUrlInflight++; next(); }
}

// storage_path → signed URL を取得(キャッシュ優先・なければEdge Function呼出)
async function getSignedThumbUrl(storagePath) {
  if (!storagePath) return null;
  const now = Date.now();
  const cached = __signedUrlCache.get(storagePath);
  if (cached && now < cached.expiresAt) return cached.url;

  await _acquireSignedUrlSlot();
  try {
    if (typeof window.callImageFunction !== 'function') return null;
    const url = `${SUPABASE_URL}/functions/v1/create-signed-url`;
    const res = await window.callImageFunction(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: storagePath, expires_in: 3600 })
    });
    if (!res || !res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json) return null;
    const signedUrl = json.signed_url || json.signedUrl || json.url;
    if (!signedUrl || typeof signedUrl !== 'string') return null;
    // メモリキャッシュのみ(localStorage禁止・チャッピー条件IV注意点)
    __signedUrlCache.set(storagePath, { url: signedUrl, expiresAt: now + SIGNED_URL_CACHE_TTL_MS });
    return signedUrl;
  } catch (e) {
    // 署名URL本体や認証情報はログに出さない(チャッピー条件IV注意点)
    console.error('[Phase 4-2F] signed URL取得失敗 path=', storagePath);
    return null;
  } finally {
    _releaseSignedUrlSlot();
  }
}

// IntersectionObserver初期化(1度だけ作成・全画像で共有)
function _initImageThumbObserver() {
  if (__imageThumbObserver) return __imageThumbObserver;
  if (typeof IntersectionObserver === 'undefined') return null;
  __imageThumbObserver = new IntersectionObserver(async (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const img = entry.target;
      const path = img.getAttribute('data-thumbnail-path');
      if (!path) { __imageThumbObserver.unobserve(img); continue; }
      // 一度観測したら解除(再取得防止)
      __imageThumbObserver.unobserve(img);
      if (img.src && !img.src.startsWith('data:')) continue;
      try {
        const url = await getSignedThumbUrl(path);
        if (url) {
          img.src = url;
        } else {
          img.alt = '画像読込失敗';
          img.style.background = '#fee';
        }
      } catch (_) {
        img.alt = '画像読込失敗';
        img.style.background = '#fee';
      }
    }
  }, { rootMargin: '200px 0px', threshold: 0.01 });
  return __imageThumbObserver;
}

// container内の data-thumbnail-path 属性を持つ img を Observer に登録
function observeImageThumbnails(container) {
  if (!container) return;
  const obs = _initImageThumbObserver();
  if (!obs) {
    // IntersectionObserver非対応(古いブラウザ)時は即時取得
    const imgs = container.querySelectorAll('img[data-thumbnail-path]:not([data-observed])');
    imgs.forEach(async img => {
      img.setAttribute('data-observed', '1');
      const path = img.getAttribute('data-thumbnail-path');
      const url = await getSignedThumbUrl(path);
      if (url) img.src = url;
    });
    return;
  }
  const imgs = container.querySelectorAll('img[data-thumbnail-path]:not([data-observed])');
  imgs.forEach(img => {
    img.setAttribute('data-observed', '1');
    obs.observe(img);
  });
}

// ═══════════════════════════════════════════
// 画像署名URLプリロード(チャッピー第79回判定 案(a) 2026-05-24)
// メッセージ一覧・引き継ぎ一覧表示後に、画像付きアイテムの
// 署名URLだけバックグラウンドで先取得して __signedUrlCache に格納する。
// 画像本体は先読みしない(通信量配慮)。
// 既存の __signedUrlCache(55分TTL)・SIGNED_URL_MAX_CONCURRENT=5 を流用。
// awaitしない・失敗握りつぶし・上限20件。
// ═══════════════════════════════════════════
function preloadMessageImageUrls(items, limit = 20) {
  try {
    const targets = (items || [])
      .map(item => item && (item.thumbnail_url || item.image_url))
      .filter(path => !!path)
      .slice(0, limit);
    for (const path of targets) {
      getSignedThumbUrl(path).catch(() => {});
    }
  } catch (e) {
    console.warn('[preloadMessageImageUrls] skipped:', e && e.message ? e.message : e);
  }
}

// メッセージ/引き継ぎ用のサムネHTML生成(共通化)
// data-thumbnail-path に storage_path を持たせ、IntersectionObserverで遅延読込
// 戻り値: '' (画像なし) または '<div class="msg-thumb-wrap">...</div>'

// ══════════════════════════════════════════════════════
// [⑫クォータ表示UI・チャッピー第58回判定 条件付きGO / 2026-05-18]
// 画像投稿クォータの残量取得・UI表示・上限到達時のボタンガード
// - JST日付で当日のクォータを取得(toISOString直使用NG・第58回判定条件6)
// - 取得失敗時は上限値で表示するフォールバック(ST版初期は許容)
// - 上限到達時は📷ボタンをdisabled + 視覚表示
// ══════════════════════════════════════════════════════

// JST日付(YYYY-MM-DD)を返す(チャッピー第58回判定 条件6)

// 当日の残量を取得(context: 'message' | 'handover')
async function getRemainingQuota(context) {
  const QUOTA_LIMITS = { message: 10, handover: 5 };
  const limit = QUOTA_LIMITS[context] || 10;
  try {
    if (!currentUser || !currentUser.eo_uid || !currentGroup || !currentGroup.id) {
      return { used: 0, limit, remaining: limit };
    }
    const today = getJstDateString();
    const { data, error } = await supabase
      .from('image_upload_quota')
      .select('upload_count')
      .eq('eo_uid', currentUser.eo_uid)
      .eq('group_session_id', currentGroup.id)
      .eq('upload_date', today)
      .eq('context', context)
      .maybeSingle();
    if (error) {
      console.warn('クォータ取得失敗・上限値で表示');
      return { used: 0, limit, remaining: limit };
    }
    const used = data?.upload_count || 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  } catch (_) {
    console.warn('クォータ取得例外・上限値で表示');
    return { used: 0, limit, remaining: limit };
  }
}

// 画像投稿エリアの残量表示・ボタン状態を更新(context は selectedComposeType から自動判定)
// [②Androidカメラ起動対策・チャッピー第59-2回判定 GO/2026-05-18] camera/library 両ボタン対応 + aria-disabled

// ══════════════════════════════════════════════════════
// [⑪運用変更・チャッピー第58回判定 条件付きGO / 2026-05-18]
// 引き継ぎリスト専用の画像ラベル表示(サムネ撤廃・「📷画像あり」テキスト表示)
// - サイネージ画面(signage.html L1031-1042)と同等仕様
// - メッセージリストには影響しない(renderImageThumbnailHtml をそのまま使う)
// - 詳細画面(showHandoverDetail内 _renderDetailImage)は無変更・タップ時に画像表示維持
// ══════════════════════════════════════════════════════

// 詳細画面用: メッセージ/引き継ぎオブジェクトから画像エリアを表示・サムネ即時取得
// [チャッピー第60-3回判定] 失敗時に再読み込みボタン+診断表示を持たせる強化版
async function _renderDetailImage(item, wrapId, imgId, statusId) {
  const wrap = document.getElementById(wrapId);
  const img = document.getElementById(imgId);
  const status = document.getElementById(statusId);
  if (!wrap || !img) return;
  // リセット(前回表示の残骸を消す)
  img.src = '';
  img.removeAttribute('data-thumbnail-path');
  img.removeAttribute('data-full-path');
  img.onclick = null;
  img.style.background = '';
  img.alt = '';
  if (status) status.innerHTML = '';
  if (!item) {
    wrap.style.display = 'none';
    return;
  }
  // [Phase 4-2I] 削除済プレースホルダ
  if (item.image_mode === 'deleted') {
    wrap.style.display = 'block';
    img.style.display = 'none';
    if (status) {
      status.innerHTML = '<div style="display:inline-flex; align-items:center; gap:6px; padding:10px 14px; background:#f5f5f5; border:1px dashed #bbb; border-radius:6px; color:#888; font-size:13px;">画像は削除されました</div>';
    }
    return;
  }
  img.style.display = 'block';
  const thumbPath = item.thumbnail_url || item.image_url;
  if (!thumbPath) {
    wrap.style.display = 'none';
    return;
  }
  img.setAttribute('data-thumbnail-path', thumbPath);
  if (item.image_url) {
    img.setAttribute('data-full-path', item.image_url);
  }
  // [Phase 4-2G] クリックで全画面拡大(フル画像取得)
  const fullPath = item.image_url || thumbPath;
  img.style.cursor = 'zoom-in';
  img.onclick = function(ev) { ev.stopPropagation(); openFullImageViewer(fullPath); };
  wrap.style.display = 'block';
  // 詳細画面は1枚のみなので即時取得(IntersectionObserverを使わない)
  await _attemptLoadDetailImage(item, img, status, thumbPath, false);
}

// [チャッピー第60-3回判定 案C+] サムネ取得試行(初回・リトライ共通)
async function _attemptLoadDetailImage(item, img, status, thumbPath, isRetry) {
  try {
    const url = await getSignedThumbUrl(thumbPath);
    if (url) {
      img.src = url;
      img.style.background = '';
      img.alt = '';
      if (status) {
        const kb = item.image_size ? Math.round(item.image_size / 1024) : null;
        const sizeText = kb ? ` ・ ${kb}KB` : '';
        status.innerHTML = `<span style="color:#666; font-size:13px;">画像${sizeText} ・ タップで拡大</span>`;
      }
    } else {
      _showImageError(item, img, status, thumbPath, isRetry);
    }
  } catch (e) {
    _showImageError(item, img, status, thumbPath, isRetry);
  }
}

// [チャッピー第60-3回判定 案C+] エラー表示+再読み込みボタン
// 1回目失敗: 再読み込みボタン表示・2回目失敗: ボタン非表示で最終文言
function _showImageError(item, img, status, thumbPath, isRetry) {
  img.alt = '画像を表示できません';
  img.style.background = '#fff3cd';
  if (!status) return;
  // 2回目失敗時はボタン非表示・最終文言
  if (isRetry) {
    status.innerHTML = `
      <div style="display:inline-block; padding:8px 12px; background:#fff3cd; border:1px solid #ffe082; border-radius:6px; color:#795548; font-size:13px; line-height:1.5;">
        画像を表示できません。EdgeOpsを一度閉じて開き直してください。
      </div>`;
    return;
  }
  // 1回目失敗:再読み込みボタン表示
  status.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:8px 12px; background:#fff3cd; border:1px solid #ffe082; border-radius:6px;">
      <span style="color:#795548; font-size:13px;">画像を表示できません</span>
      <button id="_retry-image-btn" type="button" style="padding:4px 10px; background:#1976d2; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:12px; font-weight:600;">再読み込み</button>
    </div>
    <div id="_retry-diag" style="margin-top:4px; min-height:0; display:flex; flex-direction:column; gap:2px;"></div>
  `;
  const btn = document.getElementById('_retry-image-btn');
  const diagArea = document.getElementById('_retry-diag');
  if (btn) {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      await _handleRetryImage(item, img, status, thumbPath, btn, diagArea);
    });
  }
}

// [チャッピー第60-3回判定 案C+] 再読み込みボタン押下時の処理
// JWT 強制更新 + キャッシュバイパス + 再取得 を 1ボタンで実行
async function _handleRetryImage(item, img, status, thumbPath, btn, diagArea) {
  // 多重押下防止(チャッピー第60-3回判定 条件)
  btn.disabled = true;
  btn.style.opacity = '0.6';
  btn.style.cursor = 'wait';
  btn.textContent = '⏳ 再取得中...';
  // 5秒タイムアウト(押しっぱなし防止・診断のみ)
  const timeoutId = setTimeout(() => {
    _appendDiag(diagArea, '診断: タイムアウト', '#fff3cd', '#795548');
  }, 5000);
  // ① JWT 強制更新
  let refreshOk = false;
  try {
    if (typeof window.refreshEdgeOpsAccessToken === 'function') {
      const newToken = await window.refreshEdgeOpsAccessToken();
      refreshOk = !!newToken;
    }
  } catch (_) { refreshOk = false; }
  _appendDiag(diagArea, refreshOk ? '診断: token更新 ': '診断: refresh失敗', refreshOk ? '#E6F0EF': '#ffebee', refreshOk ? '#0F6B63': '#c62828');
  // ② キャッシュバイパス
  try {
    if (typeof __signedUrlCache !== 'undefined' && __signedUrlCache && __signedUrlCache.delete) {
      __signedUrlCache.delete(thumbPath);
      _appendDiag(diagArea, '診断: キャッシュ削除 ', '#E6F0EF', '#0F6B63');
    }
  } catch (_) { /* cache 失敗は処理を止めない */ }
  // ③ 再取得
  try {
    const url = await getSignedThumbUrl(thumbPath);
    clearTimeout(timeoutId);
    if (url) {
      img.src = url;
      img.style.background = '';
      img.alt = '';
      _appendDiag(diagArea, '診断: 再取得成功 ', '#E6F0EF', '#0F6B63');
      // 成功時はステータス全体を成功表示に置換(3秒後)
      setTimeout(() => {
        if (status) {
          const kb = item.image_size ? Math.round(item.image_size / 1024) : null;
          const sizeText = kb ? ` ・ ${kb}KB` : '';
          status.innerHTML = `<span style="color:#666; font-size:13px;">画像${sizeText} ・ タップで拡大</span>`;
        }
      }, 3000);
    } else {
      _appendDiag(diagArea, '診断: 取得失敗(URL空)', '#ffebee', '#c62828');
      // 2回目失敗 → 最終文言+ボタン非表示
      setTimeout(() => _showImageError(item, img, status, thumbPath, true), 1500);
    }
  } catch (e) {
    clearTimeout(timeoutId);
    _appendDiag(diagArea, '診断: 取得失敗(throw)', '#ffebee', '#c62828');
    setTimeout(() => _showImageError(item, img, status, thumbPath, true), 1500);
  }
}

// [チャッピー第60-3回判定 案C+] 診断ログ表示ヘルパー
// 5秒後フェードアウト・token・署名URLは出力しない
function _appendDiag(area, text, bgColor, textColor) {
  if (!area) return;
  const div = document.createElement('div');
  div.style.cssText = `padding:4px 8px; background:${bgColor}; color:${textColor}; border-radius:4px; font-size:11px; display:inline-block; align-self:flex-start;`;
  div.textContent = text;
  area.appendChild(div);
  setTimeout(() => {
    div.style.transition = 'opacity 0.5s';
    div.style.opacity = '0';
    setTimeout(() => { try { div.remove(); } catch (_) {} }, 500);
  }, 5000);
}

// ═══════════════════════════════════════════
// [Phase 4-2G] 全画面拡大ビューア (ピンチズーム + ダブルタップ + パン)
// ═══════════════════════════════════════════
// 起動: openFullImageViewer(storage_path) を呼ぶ
//   - storage_path から create-signed-url 経由でフル画像URLを取得
//   - 取得完了後にビューアにフェードイン
// 操作:
//   - ピンチ: 2本指でズーム (scale 1.0 ~ 4.0)
//   - ダブルタップ: 等倍⇔2倍切替
//   - 1本指ドラッグ(拡大時のみ): パン
//   - 背景タップ(画像外): 閉じる
//   - ×ボタン: 閉じる
// ═══════════════════════════════════════════
const FULL_IMAGE_MIN_SCALE = 1.0;
const FULL_IMAGE_MAX_SCALE = 4.0;
const FULL_IMAGE_DOUBLE_TAP_SCALE = 2.0;
let __fullImageState = null; // { scale, tx, ty, startScale, startTx, startTy, startDist, startMidX, startMidY, lastTapAt }

async function openFullImageViewer(storagePath) {
  if (!storagePath) return;
  const viewer = document.getElementById('full-image-viewer');
  const imgEl = document.getElementById('full-image-content');
  const loadingEl = document.getElementById('full-image-loading');
  if (!viewer || !imgEl) return;
  // 初期化
  imgEl.src = '';
  imgEl.style.transform = 'translate(0px, 0px) scale(1)';
  __fullImageState = { scale: 1, tx: 0, ty: 0, startScale: 1, startTx: 0, startTy: 0, startDist: 0, startMidX: 0, startMidY: 0, lastTapAt: 0, panStartX: 0, panStartY: 0, panning: false };
  viewer.style.display = 'block';
  if (loadingEl) loadingEl.style.display = 'block';
  imgEl.style.visibility = 'hidden';
  // bodyスクロール停止
  document.body.style.overflow = 'hidden';
  // ESCキーで閉じる
  document.addEventListener('keydown', _fullImageEscHandler);
  // 画面外タッチで閉じる(viewer のクリック・タッチ)
  viewer.addEventListener('click', _fullImageBackgroundClickHandler);
  // フル画像URL取得(キャッシュ利用)
  try {
    const url = await getSignedThumbUrl(storagePath); // 同じキャッシュ機構を流用
    if (!url) {
      if (loadingEl) loadingEl.innerHTML = '画像を読み込めませんでした<br><span style="font-size:11px;">×ボタンで閉じる</span>';
      return;
    }
    imgEl.onload = function() {
      if (loadingEl) loadingEl.style.display = 'none';
      imgEl.style.visibility = 'visible';
      _attachFullImageGestures(imgEl);
    };
    imgEl.onerror = function() {
      if (loadingEl) loadingEl.innerHTML = '画像を読み込めませんでした<br><span style="font-size:11px;">×ボタンで閉じる</span>';
    };
    imgEl.src = url;
  } catch (e) {
    if (loadingEl) loadingEl.innerHTML = '画像を読み込めませんでした<br><span style="font-size:11px;">×ボタンで閉じる</span>';
  }
}

function closeFullImageViewer() {
  const viewer = document.getElementById('full-image-viewer');
  const imgEl = document.getElementById('full-image-content');
  if (!viewer) return;
  viewer.style.display = 'none';
  if (imgEl) {
    _detachFullImageGestures(imgEl);
    imgEl.src = '';
    imgEl.style.transform = '';
  }
  __fullImageState = null;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _fullImageEscHandler);
  viewer.removeEventListener('click', _fullImageBackgroundClickHandler);
}

function _fullImageEscHandler(ev) {
  if (ev.key === 'Escape') closeFullImageViewer();
}

function _fullImageBackgroundClickHandler(ev) {
  // 画像本体・閉じるボタン・ヒントへのクリックは閉じない
  const t = ev.target;
  if (!t) return;
  if (t.id === 'full-image-content') return;
  if (t.id === 'full-image-close-btn') return;
  if (t.closest && t.closest('#full-image-close-btn')) return;
  closeFullImageViewer();
}

// ジェスチャ実装(touch + pointer 両対応)
let __fullImageHandlers = null;

function _attachFullImageGestures(imgEl) {
  if (!imgEl) return;
  _detachFullImageGestures(imgEl); // 二重登録防止

  const onTouchStart = (ev) => {
    if (!__fullImageState) return;
    if (ev.touches.length === 2) {
      // ピンチ開始
      ev.preventDefault();
      const t1 = ev.touches[0], t2 = ev.touches[1];
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      __fullImageState.startDist = Math.hypot(dx, dy);
      __fullImageState.startScale = __fullImageState.scale;
      __fullImageState.startTx = __fullImageState.tx;
      __fullImageState.startTy = __fullImageState.ty;
      __fullImageState.startMidX = (t1.clientX + t2.clientX) / 2;
      __fullImageState.startMidY = (t1.clientY + t2.clientY) / 2;
      __fullImageState.panning = false;
    } else if (ev.touches.length === 1) {
      // 1本指: ダブルタップ判定 + パン開始
      const now = Date.now();
      const dt = now - __fullImageState.lastTapAt;
      __fullImageState.lastTapAt = now;
      if (dt < 300 && dt > 0) {
        // ダブルタップ
        ev.preventDefault();
        if (__fullImageState.scale > 1.05) {
          // 拡大中 → 等倍に戻す
          _animateFullImageTransform(1, 0, 0, imgEl);
        } else {
          // 等倍 → 2倍にズーム
          _animateFullImageTransform(FULL_IMAGE_DOUBLE_TAP_SCALE, 0, 0, imgEl);
        }
        __fullImageState.lastTapAt = 0; // 連続ダブルタップ防止
        return;
      }
      // パン開始(拡大時のみ意味あり)
      if (__fullImageState.scale > 1.05) {
        __fullImageState.panning = true;
        __fullImageState.panStartX = ev.touches[0].clientX;
        __fullImageState.panStartY = ev.touches[0].clientY;
        __fullImageState.startTx = __fullImageState.tx;
        __fullImageState.startTy = __fullImageState.ty;
      }
    }
  };

  const onTouchMove = (ev) => {
    if (!__fullImageState) return;
    if (ev.touches.length === 2) {
      // ピンチ中
      ev.preventDefault();
      const t1 = ev.touches[0], t2 = ev.touches[1];
      const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY;
      const dist = Math.hypot(dx, dy);
      if (__fullImageState.startDist > 0) {
        let newScale = __fullImageState.startScale * (dist / __fullImageState.startDist);
        newScale = Math.max(FULL_IMAGE_MIN_SCALE * 0.9, Math.min(FULL_IMAGE_MAX_SCALE, newScale));
        __fullImageState.scale = newScale;
        // ピンチ中央を中心に拡縮(簡易): 平行移動は維持
        imgEl.style.transition = 'none';
        imgEl.style.transform = `translate(${__fullImageState.tx}px, ${__fullImageState.ty}px) scale(${newScale})`;
      }
    } else if (ev.touches.length === 1 && __fullImageState.panning) {
      // パン中
      ev.preventDefault();
      const t = ev.touches[0];
      const dx = t.clientX - __fullImageState.panStartX;
      const dy = t.clientY - __fullImageState.panStartY;
      __fullImageState.tx = __fullImageState.startTx + dx;
      __fullImageState.ty = __fullImageState.startTy + dy;
      imgEl.style.transition = 'none';
      imgEl.style.transform = `translate(${__fullImageState.tx}px, ${__fullImageState.ty}px) scale(${__fullImageState.scale})`;
    }
  };

  const onTouchEnd = (ev) => {
    if (!__fullImageState) return;
    __fullImageState.panning = false;
    // 等倍以下に縮小したら中央に戻す
    if (__fullImageState.scale < 1.05) {
      _animateFullImageTransform(1, 0, 0, imgEl);
    } else {
      // バウンス(画面外に出すぎたら戻す・簡易)
      imgEl.style.transition = 'transform 0.15s ease-out';
    }
  };

  // ホイールズーム(PC向け・補助)
  const onWheel = (ev) => {
    if (!__fullImageState) return;
    ev.preventDefault();
    const delta = -ev.deltaY * 0.002;
    let newScale = __fullImageState.scale * (1 + delta);
    newScale = Math.max(FULL_IMAGE_MIN_SCALE, Math.min(FULL_IMAGE_MAX_SCALE, newScale));
    __fullImageState.scale = newScale;
    if (newScale <= 1.05) { __fullImageState.tx = 0; __fullImageState.ty = 0; }
    imgEl.style.transition = 'transform 0.1s ease-out';
    imgEl.style.transform = `translate(${__fullImageState.tx}px, ${__fullImageState.ty}px) scale(${newScale})`;
  };

  // PCダブルクリック
  const onDblClick = (ev) => {
    if (!__fullImageState) return;
    ev.preventDefault();
    if (__fullImageState.scale > 1.05) {
      _animateFullImageTransform(1, 0, 0, imgEl);
    } else {
      _animateFullImageTransform(FULL_IMAGE_DOUBLE_TAP_SCALE, 0, 0, imgEl);
    }
  };

  imgEl.addEventListener('touchstart', onTouchStart, { passive: false });
  imgEl.addEventListener('touchmove', onTouchMove, { passive: false });
  imgEl.addEventListener('touchend', onTouchEnd);
  imgEl.addEventListener('touchcancel', onTouchEnd);
  imgEl.addEventListener('wheel', onWheel, { passive: false });
  imgEl.addEventListener('dblclick', onDblClick);

  __fullImageHandlers = { onTouchStart, onTouchMove, onTouchEnd, onWheel, onDblClick };
}

function _detachFullImageGestures(imgEl) {
  if (!imgEl || !__fullImageHandlers) return;
  const h = __fullImageHandlers;
  imgEl.removeEventListener('touchstart', h.onTouchStart);
  imgEl.removeEventListener('touchmove', h.onTouchMove);
  imgEl.removeEventListener('touchend', h.onTouchEnd);
  imgEl.removeEventListener('touchcancel', h.onTouchEnd);
  imgEl.removeEventListener('wheel', h.onWheel);
  imgEl.removeEventListener('dblclick', h.onDblClick);
  __fullImageHandlers = null;
}

function _animateFullImageTransform(scale, tx, ty, imgEl) {
  if (!__fullImageState) return;
  __fullImageState.scale = scale;
  __fullImageState.tx = tx;
  __fullImageState.ty = ty;
  imgEl.style.transition = 'transform 0.2s ease-out';
  imgEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

// ═══════════════════════════════════════════
// [Phase 4-2H] 画像削除フロー (delete-image Edge Function 呼出)
// ═══════════════════════════════════════════
// 起動: deleteImageOnly(itemId, context) ('message' | 'handover')
//   - 自分が送信者かつ image_mode='attached' のメッセージのみ削除可能
//   - 確認ダイアログ → delete-image Edge Function → 描画更新
//   - 削除後はサーバー側で image_mode='deleted' に更新される
// feature_flags.image_delete が FALSE なら削除ボタン非表示・送信直前にも再確認
// ═══════════════════════════════════════════
async function isImageDeleteEnabled() {
  try {
    const flags = await getFeatureFlags(false);
    return !!(flags && flags.image_upload && flags.image_delete);
  } catch (_) { return false; }
}

async function deleteImageOnly(itemId, context) {
  if (!itemId) { showToast('対象が指定されていません'); return; }
  if (context !== 'message' && context !== 'handover') {
    showToast('内部エラー(context)');
    return;
  }
  // 削除機能フラグ強制再取得(緊急OFF即時反映)
  let flags;
  try { flags = await getFeatureFlags(true); }
  catch (_) { flags = null; }
  if (!flags || !flags.image_upload || !flags.image_delete) {
    showToast('画像削除は現在利用できません');
    return;
  }
  // 確認ダイアログ
  // [2026/5/20 野口さん指示] クォータ警告追加(削除しても投稿可能数は戻らない・明日0時リセット)
  if (!confirm('この画像を削除しますか?\n\n本文は残り、画像のみ削除されます。\n削除した画像は復元できません。\n\n 注意:画像を削除しても、本日の投稿可能数は戻りません。\n(明日0時にリセットされます)')) return;

  showToast('削除中...');
  try {
    if (typeof window.callImageFunction !== 'function') {
      throw new Error('AUTH_HELPER_MISSING');
    }
    const url = `${SUPABASE_URL}/functions/v1/delete-image`;
    const res = await window.callImageFunction(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: itemId, context: context })
    });
    if (!res || !res.ok) {
      let errorCode = 'SERVER_ERROR';
      try {
        const errBody = await res.text();
        if (errBody) {
          try {
            const errJson = JSON.parse(errBody);
            errorCode = errJson.error || errJson.code || `HTTP_${res.status}`;
          } catch (_) { errorCode = `HTTP_${res.status}`; }
        } else { errorCode = `HTTP_${res.status}`; }
      } catch (_) { errorCode = `HTTP_${(res && res.status) || 'UNKNOWN'}`; }
      throw new Error(errorCode);
    }
    showToast('画像を削除しました');
    // 描画更新
    if (context === 'message') {
      await loadMessages();
      // 詳細画面表示中なら再描画
      const detailScreen = document.getElementById('screen-detail');
      if (detailScreen && detailScreen.classList.contains('active')) {
        try { await showDetail(itemId); } catch (_) {}
      } else {
        showScreen('screen-home');
      }
    } else {
      await loadHandoverNotes();
      const hwDetailScreen = document.getElementById('screen-handover-detail');
      if (hwDetailScreen && hwDetailScreen.classList.contains('active')) {
        try { await showHandoverDetail(itemId); } catch (_) {}
      } else {
        showScreen('screen-handover');
      }
    }
  } catch (e) {
    const code = (e && e.message) || 'UNKNOWN_ERROR';
    let msg = '削除に失敗しました';
    if (code === 'NOT_OWNER' || code === 'FORBIDDEN' || code.startsWith('HTTP_403')) {
      msg = '自分が投稿した画像のみ削除できます';
    } else if (code === 'ALREADY_DELETED' || code === 'NOT_FOUND' || code.startsWith('HTTP_404')) {
      msg = 'この画像はすでに削除されています';
      // 表示を最新化
      if (context === 'message') { try { await loadMessages(); } catch (_) {} }
      else { try { await loadHandoverNotes(); } catch (_) {} }
    } else if (code === 'AUTH_TOKEN_INVALID' || code === 'AUTH_TOKEN_EXPIRED' || code === 'AUTH_TOKEN_MISSING') {
      msg = '認証エラー。LINEを開き直してください';
    } else if (code === 'FEATURE_DISABLED' || code === 'IMAGE_DELETE_DISABLED') {
      msg = '画像削除は現在利用できません';
    } else if (code.startsWith('HTTP_5') || code === 'SERVER_ERROR') {
      msg = '通信エラー。もう一度お試しください';
    }
    showToast(msg);
    console.error('[Phase 4-2H] 画像削除失敗:', code);
  }
}
