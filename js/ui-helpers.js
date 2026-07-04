// ════════════════════════════════════════════════════════════════════
// js/ui-helpers.js  ── UI補助関数 (Phase 2分離)
// index.html から移動した状態を持たない UI 補助関数 30個
// type="module" 不使用・import/export 不使用・トップレベル実行なし
// ════════════════════════════════════════════════════════════════════

async function applyImageUploadButtonVisibility() {
  // compose画面の📷/🖼️ボタン表示制御。feature_flagsの状態 + isCreatorロールにより出し分け。
  // [チャッピー第52回判定 修正1] isCreator !== true の場合は無条件で非表示
  // [②Androidカメラ起動対策・チャッピー第59-2回判定 GO/2026-05-18] camera/library 2ボタン対応
  const btnCamera = document.getElementById('compose-image-btn-camera');
  const btnLibrary = document.getElementById('compose-image-btn-library');
  if (!btnCamera || !btnLibrary) return;
  const hideBoth = () => { btnCamera.style.display = 'none'; btnLibrary.style.display = 'none'; };
  if (isCreator !== true) { hideBoth(); return; }
  try {
    const flags = await getFeatureFlags(false);
    if (!flags.image_upload) { hideBoth(); return; }
    const ctx = (typeof selectedComposeType === 'string') ? selectedComposeType : 'msg';
    if (ctx === 'msg' && !flags.image_upload_message) { hideBoth(); return; }
    if (ctx === 'handover' && !flags.image_upload_handover) { hideBoth(); return; }
    btnCamera.style.display = 'inline-flex';
    btnLibrary.style.display = 'inline-flex';
  } catch (_) {
    hideBoth();
  }
  // [⑫クォータ表示UI] ボタン表示更新後にクォータUIも更新(非表示時はクリアされる)
  try { updateImageQuotaUI(); } catch (_) {}
}

function renderImageThumbnailHtml(item) {
  if (!item) return '';
  // [Phase 4-2I] image_mode='deleted' は「🗑️ 削除済」プレースホルダ表示
  if (item.image_mode === 'deleted') {
    return `<div class="msg-thumb-wrap" style="margin-top:8px;">
      <div style="display:inline-flex; align-items:center; gap:6px; padding:10px 14px; background:#f5f5f5; border:1px dashed #bbb; border-radius:6px; color:#888; font-size:12px;">
        🗑️ 画像は削除されました
      </div>
    </div>`;
  }
  // image_url + thumbnail_url のどちらかがあれば表示対象(優先: thumbnail_url)
  const thumbPath = item.thumbnail_url || item.image_url;
  if (!thumbPath) return '';
  const escPath = escHtml(thumbPath);
  const fullPath = item.image_url ? escHtml(item.image_url) : escPath;
  // [Phase 4-2G] クリックで全画面拡大(フル画像取得)
  // [チャッピー第53回判定後・4回目] image-orientation: from-image で表示時にEXIF適用
  return `<div class="msg-thumb-wrap" style="margin-top:8px;">
    <img data-thumbnail-path="${escPath}"
         data-full-path="${fullPath}"
         alt="画像読込中..."
         loading="lazy"
         style="max-width:160px; max-height:120px; border-radius:6px; background:#e4e8f0; object-fit:cover; display:block; cursor:zoom-in; image-orientation:from-image;"
         onclick="event.stopPropagation(); openFullImageViewer('${fullPath}')">
  </div>`;
}

function getJstDateString() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().substring(0, 10);
}

async function updateImageQuotaUI() {
  const btnCamera = document.getElementById('compose-image-btn-camera');
  const btnLibrary = document.getElementById('compose-image-btn-library');
  const quotaEl = document.getElementById('compose-image-quota');
  if (!btnCamera || !btnLibrary || !quotaEl) return;
  // 両ボタンとも非表示なら残量UIも空に(isCreator!==true / feature_flags OFF時)
  if ((btnCamera.style.display === 'none' && btnLibrary.style.display === 'none') || isCreator !== true) {
    quotaEl.innerHTML = '';
    return;
  }
  // context判定(selectedComposeType: 'msg' or 'handover' → 'message' or 'handover')
  const ctx = (typeof selectedComposeType === 'string' && selectedComposeType === 'handover') ? 'handover' : 'message';
  const { remaining, limit } = await getRemainingQuota(ctx);
  if (remaining > 0) {
    quotaEl.innerHTML = `<span style="font-size:11px; color:var(--text-light);">📊 あと <strong style="color:#06C755;">${remaining}</strong> 回投稿できます</span>`;
    // [チャッピー第59-2回判定] btn.disabled は使わず opacity/cursor/aria-disabled のみで視覚演出
    btnCamera.style.opacity = '1';
    btnCamera.style.cursor = 'pointer';
    btnCamera.setAttribute('aria-disabled', 'false');
    btnLibrary.style.opacity = '1';
    btnLibrary.style.cursor = 'pointer';
    btnLibrary.setAttribute('aria-disabled', 'false');
  } else {
    quotaEl.innerHTML = `<span style="font-size:11px; color:var(--red);">⛔ 本日の上限(${limit}回)に達しました・明日0時にリセット</span>`;
    btnCamera.style.opacity = '0.4';
    btnCamera.style.cursor = 'not-allowed';
    btnCamera.setAttribute('aria-disabled', 'true');
    btnLibrary.style.opacity = '0.4';
    btnLibrary.style.cursor = 'not-allowed';
    btnLibrary.setAttribute('aria-disabled', 'true');
  }
}

function renderHandoverImageLabel(item) {
  // [チャッピー第60-3回判定 解釈β] サイネージと同配置・priority-badge右横にインライン
  if (!item) return '';
  if (item.image_mode === 'deleted') {
    return `<span class="priority-badge" style="background:#f5f5f5; color:#888; border:1px solid #bbb; margin-left:6px;">🗑️ 削除済</span>`;
  }
  if (item.image_url || item.thumbnail_url) {
    return `<span class="priority-badge" style="background:rgba(33,150,243,0.15); color:#1976d2; border:1px solid rgba(144,202,249,0.7); margin-left:6px;">📷 画像あり</span>`;
  }
  return '';
}

function updateExpiryWarningBar() {
  const bar = document.getElementById('expiry-warning-bar');
  if (!bar) return;
  // ST版以外(EO-など)は対象外
  const groupId = currentGroup?.group_id || '';
  if (!groupId.startsWith('SL-')) {
    bar.style.display = 'none';
    return;
  }
  if (!currentGroup?.expires_at) {
    bar.style.display = 'none';
    return;
  }
  const exp = new Date(currentGroup.expires_at);
  const now = new Date();
  const daysLeft = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
  if (daysLeft > 30) {
    bar.style.display = 'none';
    return;
  }
  bar.classList.remove('warning', 'danger');
  bar.classList.add(daysLeft <= 7 ? 'danger' : 'warning');
  if (daysLeft <= 0) {
    bar.textContent = '⚠️ このグループは有効期限を過ぎています';
  } else {
    bar.textContent = `⚠️ あと${daysLeft}日でこのグループは使用できなくなります`;
  }
  bar.style.display = 'block';
}

function renderTemplates() {
  const wrap = document.getElementById('template-section');
  if (!wrap) return;
  // 引き継ぎタブ・連絡テンプレ未登録時は非表示(一般スタッフは行き止まりを作らない)
  if (selectedComposeType === 'handover' || !_groupTemplatesCache || _groupTemplatesCache.length === 0) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  const list = document.getElementById('template-list');
  list.innerHTML = _groupTemplatesCache.map(t =>
    `<button class="template-btn" onclick="applyTemplate('${t.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">📋 ${escapeHtml(t)}</button>`
  ).join('');
}

// HTMLエスケープ(テンプレ表示の安全化)
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function applyHandoverPriorityUI(p) {
  ['action','check','done'].forEach(v => {
    const el = document.getElementById('hwsel-' + v);
    if (el) { el.style.opacity = v === p ? '1' : '0.45'; el.style.transform = v === p ? 'scale(1.04)' : ''; }
  });
}

async function updateHandoverBadge() {
  try {
    // 72時間以内の引き継ぎを取得（sender_eo_uidも含めて取得）
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data: notes } = await supabase.from('handover_notes').select('id, sender_eo_uid')
      .eq('group_session_id', currentGroup.id).gte('created_at', cutoff);
    if (!notes || notes.length === 0) {
      document.getElementById('handover-badge-bar').style.display = 'none';
      return;
    }

    // 自分がサイネージ端末かどうか確認
    const myMemberInfo = members.find(m => m.eo_uid === currentUser.eo_uid);
    const amISignage = myMemberInfo && myMemberInfo.is_signage;

    let targetNotes;
    if (amISignage) {
      // サイネージ端末：全員の未確認件数を表示
      targetNotes = notes;
    } else {
      // スタッフ：自分が投稿した未確認のみ表示
      // [2026/5/25 1人グループ論理破綻対応 / チャッピー第86回判定GO]
      // 自分以外の人間メンバーが0人の場合、確認依頼先が存在しないためバナー対象なし
      const otherHumanMembers = members.filter(m =>
        !m.is_signage && m.eo_uid !== currentUser.eo_uid
      );
      targetNotes = otherHumanMembers.length === 0
        ? []
        : notes.filter(n => n.sender_eo_uid === currentUser.eo_uid);
    }

    if (targetNotes.length === 0) {
      document.getElementById('handover-badge-bar').style.display = 'none';
      return;
    }
    const noteIds = targetNotes.map(n => n.id);
    // 全confirmationsを取得（確認済み＋完了済み判定に使う）
    const { data: allConfirms } = await supabase.from('handover_confirmations').select('handover_id, eo_uid, action')
      .in('handover_id', noteIds);
    // 誰かが確認済みのID
    const confirmedIds = new Set((allConfirms || []).map(c => c.handover_id));
    // 誰かがtakeover/doneを押した完了済みのID（バッジカウントから除外）
    const completedIds = new Set((allConfirms || []).filter(c => c.action === 'takeover' || c.action === 'done').map(c => c.handover_id));
    // 誰も確認しておらず完了済みでないものだけカウント
    const unconfirmedCount = noteIds.filter(id => !confirmedIds.has(id) && !completedIds.has(id)).length;
    const bar = document.getElementById('handover-badge-bar');
    const countEl = document.getElementById('handover-badge-count');
    if (unconfirmedCount > 0) {
      bar.style.display = 'flex';
      countEl.textContent = unconfirmedCount;
      const msgEl = document.getElementById('handover-badge-msg');
      if (msgEl) {
        msgEl.textContent = amISignage
          ? '全員分の未確認引き継ぎ事項があります'
          : '自分が投稿した未確認の引き継ぎがあります';
      }
    } else {
      bar.style.display = 'none';
    }
  } catch (e) { console.error(e); }
}

function renderHandoverCardHtml(hw, confs, myConf) {
  const pLabels = { action: '🔴 重要', check: '🟡 通常', done: '🟢 確認要' };
  const pClass  = { action: 'hw-action', check: 'hw-check', done: 'hw-done' };
  const p = hw.priority || 'check';
  const confirmNames = (confs || []).map(c => c.display_name).join('・');
  const isSender = hw.sender_eo_uid === currentUser.eo_uid;
  const confirmedByMe = myConf ? true : false;
  // 誰かがtakeover/doneを押していたら完了済み
  const isCompleted = (confs || []).some(c => c.action === 'takeover' || c.action === 'done');
  const completedConf = (confs || []).find(c => c.action === 'takeover' || c.action === 'done');
  let statusHtml;
  if (isSender) {
    if (isCompleted) {
      const cl = completedConf.action === 'takeover' ? '引き継ぎました' : '対応しました';
      statusHtml = `<div style="font-size:11px; color:var(--text-light); margin-top:6px;">📋 自分が投稿（🔒 ${escHtml(completedConf.display_name)}が${cl}）</div>`;
    } else if (confirmNames) {
      statusHtml = `<div style="font-size:11px; color:var(--text-light); margin-top:6px;">📋 自分が投稿</div><div class="handover-confirm-names">✅ 確認済み：${escHtml(confirmNames)}</div>`;
    } else {
      statusHtml = `<div style="font-size:11px; color:var(--text-light); margin-top:6px;">📋 自分が投稿</div><div class="handover-unconfirmed">⚠️ 未確認</div>`;
    }
  } else if (isCompleted) {
    const cl = completedConf.action === 'takeover' ? '引き継ぎました' : '対応しました';
    statusHtml = `<div class="handover-confirm-names">🔒 ${escHtml(completedConf.display_name)}が${cl}</div>`;
  } else if (confirmedByMe) {
    statusHtml = `<div class="handover-confirm-names">✅ 確認済み${confirmNames ? '：' + escHtml(confirmNames) : ''}</div>`;
  } else {
    statusHtml = `<div class="handover-unconfirmed">⚠️ 未確認${confirmNames ? '（確認済：' + escHtml(confirmNames) + '）' : ''}</div>`;
  }
  // [チャッピー第60-3回判定 解釈β] 引き継ぎ側も📷画像あり配置をサイネージと統一(priority-badge右横)
  return `
    <div class="handover-card priority-${p}" onclick="showHandoverDetail('${hw.id}')">
      <span class="handover-priority-badge ${pClass[p]}">${pLabels[p]}</span>${renderHandoverImageLabel(hw)}
      <div class="msg-title">${getMessageTitle(hw.content||'', 40)}</div>
      <div class="msg-meta">${escHtml(hw.sender_name)}　${formatTime(hw.created_at)}</div>
      ${statusHtml}
    </div>`;
}

function renderHandoverInline(container) {
  if (handoverNotes.length === 0) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">引き継ぎノートはまだありません</div></div>';
    return;
  }
  // 引き継ぎノート画面と同じソート順：新しい順のみ
  const hwConfirmMap = window._hwConfirmMap || {};
  const priorityOrder = { action: 0, check: 1, done: 2 };
  const myUid = currentUser.eo_uid;
  const sorted = [...handoverNotes].sort((a, b) => {
    return new Date(b.created_at) - new Date(a.created_at);
  });
  let html = '<div class="card">';
  sorted.forEach(hw => {
    const confs = hwConfirmMap[hw.id] || [];
    const myConf = confs.find(c => c.eo_uid === myUid);
    html += renderHandoverCardHtml(hw, confs, myConf);
  });
  html += '</div>';
  container.innerHTML = html;
  // [Phase 4-2F] 引き継ぎサムネを IntersectionObserver に登録
  try { observeImageThumbnails(container); } catch (_) {}
}

function updateSurveyButtonState() {
  const input = document.getElementById('detail-survey-input');
  const submitBtn = document.getElementById('detail-survey-submit');
  const naBtn = document.getElementById('detail-survey-na');
  const charCount = document.getElementById('detail-survey-char-count');
  if (!input || !submitBtn || !naBtn) return;
  const hasText = input.value.trim().length > 0;
  if (charCount) charCount.textContent = String(input.value.length);
  // 「アンケート回答」は文字があるときだけ押せる
  submitBtn.disabled = !hasText;
  submitBtn.style.opacity = hasText ? '1' : '0.5';
  submitBtn.style.cursor = hasText ? 'pointer' : 'not-allowed';
  // 「該当なし」は文字入力中は押せない
  naBtn.disabled = hasText;
  naBtn.style.opacity = hasText ? '0.5' : '1';
  naBtn.style.cursor = hasText ? 'not-allowed' : 'pointer';
}

function wasMemberAtItemCreated(member, itemCreatedAt) {
  if (!member) return false;
  if (member.is_signage === true) return false;
  if (member.status !== 'approved') return false;
  if (!member.created_at) return true; // 既存データ救済
  if (!itemCreatedAt) return true;     // 未取得時は閉じない側に倒す
  const joinedMs = new Date(member.created_at).getTime();
  const itemMs = new Date(itemCreatedAt).getTime();
  if (isNaN(joinedMs) || isNaN(itemMs)) return true;
  return joinedMs <= itemMs;
}

function updateReportTabUI() {
  const lastBtn = document.getElementById('tab-lastmonth');
  const thisBtn = document.getElementById('tab-thismonth');
  if (currentReportTab === 'last') {
    lastBtn.style.background = 'var(--green)'; lastBtn.style.borderColor = 'var(--green)'; lastBtn.style.color = 'white';
    thisBtn.style.background = 'white'; thisBtn.style.borderColor = 'var(--border)'; thisBtn.style.color = 'var(--text-mid)';
  } else {
    thisBtn.style.background = 'var(--green)'; thisBtn.style.borderColor = 'var(--green)'; thisBtn.style.color = 'white';
    lastBtn.style.background = 'white'; lastBtn.style.borderColor = 'var(--border)'; lastBtn.style.color = 'var(--text-mid)';
  }
}

function updateLinkButton() {
  const btn = document.getElementById('link-btn');
  if (!btn) return;
  // currentGroup.link_url が文字列で空文字以外の場合のみ表示
  const url = (currentGroup && typeof currentGroup.link_url === 'string') ? currentGroup.link_url.trim() : '';
  if (url && /^https:\/\//.test(url)) {
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
  } else {
    btn.style.display = 'none';
  }
}

async function updateMemberCount() {
  const membersEl = document.getElementById('profile-members');
  if (!membersEl || !currentGroup?.id) return;
  const maxMembers = currentGroup.max_members || 50;
  const { count } = await supabase
    .from('group_members')
    .select('*', { count: 'exact', head: true })
    .eq('group_session_id', currentGroup.id)
    .eq('status', 'approved');
  membersEl.textContent = `👥 参加中：${count || 0} / ${maxMembers}人`;
}

function updateSignageUrlDisplay() {
  const el = document.getElementById('signage-url-display');
  const copyBtn = document.getElementById('copy-signage-btn');
  if (!el) return;
  if (currentGroup?.signage_token && currentGroup?.signage_enabled) {
    el.textContent = '✅ サイネージURLが発行済みです';
    el.style.color = '#2e7d32';
    if (copyBtn) copyBtn.style.display = 'block';
  } else if (currentGroup?.signage_token && !currentGroup?.signage_enabled) {
    el.textContent = '⚠️ サイネージは無効化されています';
    el.style.color = '#e53935';
    if (copyBtn) copyBtn.style.display = 'none';
  } else {
    el.textContent = 'URLが未発行です。「URL発行・再生成」をタップしてください。';
    el.style.color = 'var(--text-light)';
    if (copyBtn) copyBtn.style.display = 'none';
  }
}

function copySignageUrl() {
  if (!currentGroup?.signage_token) return;
  const url = `https://app.edgeops.jp/signage.html?token=${currentGroup.signage_token}`;
  navigator.clipboard?.writeText(url).then(() => showToast('URLをコピーしました'));
}

function copyGroupId() {
  const id = currentGroup?.group_id;
  if (!id) return;
  navigator.clipboard?.writeText(id).then(() => showToast('グループIDをコピーしました'));
}

function generateGroupId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const part1 = Array.from({length:5}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  const part2 = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join('');
  return `SL-${part1}-${part2}`;
}

function getMemberName(eoUid) {
  const member = members.find(m => m.eo_uid === eoUid);
  return member?.display_name || '不明';
}

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString); const now = new Date(); const diff = now - d;
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return `${Math.floor(diff/60000)}分前`;
  if (diff < 86400000) return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
  return `${d.getMonth()+1}/${d.getDate()}`;
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// URLをタップ可能なリンクに変換（連絡・引き継ぎ共用）
function linkify(text) {
  const escaped = escHtml(text);
  return escaped.replace(
    /(https?:\/\/[^\s&]+(?:&amp;[^\s]*)*)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--green);text-decoration:underline;word-break:break-all;">$1</a>'
  );
}

// URLかどうか判定してヘッダータイトルを返す
function getMessageTitle(body, maxLen) {
  if (!body) return '';
  if (/^https?:\/\//.test(body.trim())) return '🔗 リンクを含むメッセージ';
  const s = body.substring(0, maxLen);
  return s + (body.length > maxLen ? '…' : '');
}

function hideLoading() { document.getElementById('loading').style.display = 'none'; }

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

async function updateGroupSwitcherBtn() {
  const btn = document.getElementById('group-switch-btn');
  if (!btn || !currentUser?.eo_uid) return;
  const { count } = await supabase
    .from('group_members')
    .select('id', { count: 'exact', head: true })
    .eq('eo_uid', currentUser.eo_uid)
    .eq('status', 'approved');
  const others = Math.max(0, (count || 0) - 1);
  btn.textContent = `📋 他のグループに切替 (${others})`;
}
