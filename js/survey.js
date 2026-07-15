function applySurveyVisibility(isMsgActive) {
  const wrap = document.getElementById('survey-section');
  if (!wrap) return;
  // グローバル変数 isCreator を使用（members 配列のロードタイミングに依存しない）
  // members 配列が空でも、グループ参加時に設定済みの isCreator で判定できる
  if (isMsgActive && isCreator === true) {
    wrap.style.display = '';
  } else {
    wrap.style.display = 'none';
    // 引き継ぎ切替時はチェック・締切をリセット（状態のリーク防止）
    const cb = document.getElementById('survey-checkbox');
    if (cb) cb.checked = false;
    const dl = document.getElementById('survey-deadline-wrap');
    if (dl) dl.style.display = 'none';
    const di = document.getElementById('survey-deadline-input');
    if (di) di.value = '';
  }
}
function toggleSurveyMode() {
  const cb = document.getElementById('survey-checkbox');
  const dl = document.getElementById('survey-deadline-wrap');
  if (!cb || !dl) return;
  dl.style.display = cb.checked ? '' : 'none';
  if (!cb.checked) {
    const di = document.getElementById('survey-deadline-input');
    if (di) di.value = '';
  }
}
async function applySurveyDetailUI(msg) {
  const wrap = document.getElementById('detail-survey-wrap');
  if (!wrap) return;
  // 通常メッセージなら非表示
  if (!msg || msg.is_survey !== true) {
    wrap.style.display = 'none';
    return;
  }
  // サイネージ端末は回答UI非表示（見せる専用）
  const myMember = members.find(m => m.eo_uid === currentUser.eo_uid);
  if (myMember && myMember.is_signage) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';

  // 締切表示の組み立て
  const dlEl = document.getElementById('detail-survey-deadline');
  let isExpired = false;
  if (msg.survey_deadline) {
    const d = new Date(msg.survey_deadline);
    isExpired = Date.now() > d.getTime();
    const yyyy = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const youbi = ['日','月','火','水','木','金','土'][d.getDay()];
    const hh = String(d.getHours()).padStart(2,'0');
    const mm = String(d.getMinutes()).padStart(2,'0');
    if (dlEl) dlEl.textContent = `締切: ${m}/${day}(${youbi}) ${hh}:${mm}`;
  } else {
    if (dlEl) dlEl.textContent = '締切なし';
  }

  // 既存回答取得
  let myResponse = null;
  try {
    const { data } = await supabase.from('message_responses')
      .select('*')
      .eq('message_id', msg.id)
      .eq('eo_uid', currentUser.eo_uid)
      .maybeSingle();
    myResponse = data;
  } catch (e) { console.error(e); }

  const answerArea = document.getElementById('detail-survey-answer-area');
  const statusEl = document.getElementById('detail-survey-status');
  const closedEl = document.getElementById('detail-survey-closed');

  if (isExpired) {
    // 締切後：回答UI非表示・締切済み表示
    if (answerArea) answerArea.style.display = 'none';
    if (closedEl) closedEl.style.display = '';
    if (statusEl) {
      if (myResponse) {
        statusEl.style.display = '';
        if (myResponse.status === 'answered') {
          statusEl.innerHTML = `<div style="color:#0F6B63; font-weight:600;">あなたの回答：</div><div style="margin-top:4px;">${escHtml(myResponse.response_text || '')}</div>`;
        } else {
          statusEl.innerHTML = `<div style="color:#666; font-weight:600;">あなたは「該当なし」を選択しました</div>`;
        }
      } else {
        statusEl.style.display = '';
        statusEl.innerHTML = `<div style="color:#999;">回答していません</div>`;
      }
    }
    return;
  }

  // 締切前：回答UI表示
  if (answerArea) answerArea.style.display = '';
  if (closedEl) closedEl.style.display = 'none';

  // 既存回答があれば表示しつつ、再回答も可能にする
  const input = document.getElementById('detail-survey-input');
  const charCount = document.getElementById('detail-survey-char-count');
  if (input) {
    input.value = myResponse && myResponse.status === 'answered' ? (myResponse.response_text || '') : '';
    if (charCount) charCount.textContent = String(input.value.length);
  }
  if (statusEl) {
    if (myResponse) {
      statusEl.style.display = '';
      if (myResponse.status === 'answered') {
        statusEl.innerHTML = `<div style="color:#0F6B63; font-weight:600;">回答済み（再回答可）</div>`;
      } else {
        statusEl.innerHTML = `<div style="color:#666; font-weight:600;">「該当なし」選択中（変更可）</div>`;
      }
    } else {
      statusEl.style.display = 'none';
      statusEl.innerHTML = '';
    }
  }
  updateSurveyButtonState();
}
async function submitSurveyResponse() {
  if (!currentDetailMessageId) return;
  const input = document.getElementById('detail-survey-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text) { showToast('回答を入力してください'); return; }
  if (text.length > 20) { showToast('20文字以内で入力してください'); return; }
  // 締切チェック
  const msg = messages.find(m => m.id === currentDetailMessageId);
  if (msg && msg.survey_deadline && Date.now() > new Date(msg.survey_deadline).getTime()) {
    showToast('締切を過ぎています');
    return;
  }
  try {
    showToast('送信中...');
    const { error } = await supabase.from('message_responses').upsert({
      message_id: currentDetailMessageId,
      eo_uid: currentUser.eo_uid,
      response_text: text,
      status: 'answered',
      updated_at: new Date().toISOString()
    }, { onConflict: 'message_id, eo_uid' });
    if (error) throw error;
    showToast('回答しました！');
    // 状態反映：詳細画面・一覧両方を更新
    if (msg) await applySurveyDetailUI(msg);
    await loadMessages();
  } catch (e) {
    console.error(e);
    showToast('回答送信に失敗しました');
  }
}
async function submitSurveyNotApplicable() {
  if (!currentDetailMessageId) return;
  const input = document.getElementById('detail-survey-input');
  if (input && input.value.trim().length > 0) return; // 念のためガード
  // 締切チェック
  const msg = messages.find(m => m.id === currentDetailMessageId);
  if (msg && msg.survey_deadline && Date.now() > new Date(msg.survey_deadline).getTime()) {
    showToast('締切を過ぎています');
    return;
  }
  try {
    showToast('送信中...');
    const { error } = await supabase.from('message_responses').upsert({
      message_id: currentDetailMessageId,
      eo_uid: currentUser.eo_uid,
      response_text: null,
      status: 'not_applicable',
      updated_at: new Date().toISOString()
    }, { onConflict: 'message_id, eo_uid' });
    if (error) throw error;
    showToast('「該当なし」で記録しました');
    if (msg) await applySurveyDetailUI(msg);
    await loadMessages();
  } catch (e) {
    console.error(e);
    showToast('送信に失敗しました');
  }
}
async function showSurveyList() {
  const modal = document.getElementById('modal-survey-list');
  const content = document.getElementById('survey-list-content');
  modal.style.display = 'block';
  content.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';
  try {
    // 60日以内のアンケートメッセージを取得
    const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: surveys } = await supabase.from('messages')
      .select('*')
      .eq('group_session_id', currentGroup.id)
      .eq('is_survey', true)
      .gte('created_at', cutoff60d)
      .order('created_at', { ascending: false });
    if (!surveys || surveys.length === 0) {
      content.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:24px;">アンケートはまだありません<br><span style="font-size:12px;">※過去60日以内のアンケートを表示します</span></div>';
      return;
    }
    // 各アンケートの回答数を取得
    const surveyIds = surveys.map(s => s.id);
    const { data: resps } = await supabase.from('message_responses')
      .select('message_id, status')
      .in('message_id', surveyIds);
    const respCountMap = {};
    (resps || []).forEach(r => {
      if (!respCountMap[r.message_id]) respCountMap[r.message_id] = { answered: 0, na: 0 };
      if (r.status === 'answered') respCountMap[r.message_id].answered++;
      else if (r.status === 'not_applicable') respCountMap[r.message_id].na++;
    });
    // 分母：現メンバー（サイネージ除外）
    const denominator = members.filter(m => !m.is_signage).length;
    const html = surveys.map(s => {
      const counts = respCountMap[s.id] || { answered: 0, na: 0 };
      const senderName = getMemberName(s.sender_eo_uid);
      const timeStr = formatTime(s.created_at);
      const title = getMessageTitle(s.body, 30);
      // 締切表示
      let deadlineHtml = '';
      if (s.survey_deadline) {
        const d = new Date(s.survey_deadline);
        const isExpired = Date.now() > d.getTime();
        const youbi = ['日','月','火','水','木','金','土'][d.getDay()];
        const m = d.getMonth() + 1;
        const day = d.getDate();
        deadlineHtml = isExpired
          ? `<div style="font-size:11px; color:#c62828; font-weight:600;">${t('label_closed')} (${m}/${day}(${youbi}))</div>`
          : `<div style="font-size:11px; color:var(--text-mid);">締切: ${m}/${day}(${youbi}) 23:59</div>`;
      } else {
        deadlineHtml = `<div style="font-size:11px; color:var(--text-light);">締切なし</div>`;
      }
      return `
        <div onclick="showSurveyDetail('${s.id}')" style="cursor:pointer; padding:12px; margin-bottom:8px; border:1px solid var(--border); border-radius:8px; background:white;">
          <div style="font-size:14px; font-weight:600; margin-bottom:4px;">${escHtml(title)}</div>
          <div style="font-size:11px; color:var(--text-light); margin-bottom:6px;">${escHtml(senderName)} ・ ${timeStr}</div>
          ${deadlineHtml}
          <div style="display:flex; gap:6px; margin-top:8px; font-size:11px;">
            <span style="background:#E6F0EF; color:#0F6B63; padding:2px 8px; border-radius:4px;">回答 ${counts.answered}</span>
            <span style="background:#ede7f6; color:#5e35b1; padding:2px 8px; border-radius:4px;">— 該当なし ${counts.na}</span>
            <span style="background:#f5f5f5; color:#666; padding:2px 8px; border-radius:4px;">未回答 ${Math.max(denominator - counts.answered - counts.na, 0)}</span>
          </div>
        </div>
      `;
    }).join('');
    content.innerHTML = `<div style="font-size:12px; color:var(--text-light); margin-bottom:8px;">${surveys.length}件のアンケート（過去60日）</div>` + html;
  } catch(e) {
    console.error(e);
    content.innerHTML = '<div style="text-align:center;color:var(--red);padding:24px;">取得に失敗しました</div>';
  }
}
async function showSurveyDetail(messageId) {
  const modal = document.getElementById('modal-survey-detail');
  const content = document.getElementById('survey-detail-content');
  const titleEl = document.getElementById('survey-detail-title');
  modal.style.display = 'block';
  content.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';
  try {
    // メッセージ取得
    const { data: msg } = await supabase.from('messages')
      .select('*').eq('id', messageId).single();
    if (!msg) throw new Error('メッセージが見つかりません');
    if (titleEl) titleEl.textContent = getMessageTitle(msg.body, 25);

    // 現メンバー（サイネージ除外）取得
    const { data: memberList } = await supabase
      .from('group_members')
      .select('eo_uid, display_name, is_creator, is_signage')
      .eq('group_session_id', currentGroup.id)
      .eq('status', 'approved');
    const targetMembers = (memberList || []).filter(m => !m.is_signage);

    // 回答取得
    const { data: resps } = await supabase.from('message_responses')
      .select('*').eq('message_id', messageId);
    const respMap = {};
    (resps || []).forEach(r => { respMap[r.eo_uid] = r; });

    // 既読取得
    const { data: reads } = await supabase.from('read_receipts')
      .select('eo_uid, read_at').eq('message_id', messageId);
    const readMap = {};
    (reads || []).forEach(r => { readMap[r.eo_uid] = r; });

    // 3セクションに分類：未回答 → 該当なし → 回答済み
    const notAnswered = [];
    const notApplicable = [];
    const answered = [];
    targetMembers.forEach(m => {
      const r = respMap[m.eo_uid];
      if (!r) {
        notAnswered.push({ ...m, read: !!readMap[m.eo_uid] });
      } else if (r.status === 'not_applicable') {
        notApplicable.push({ ...m, response: r, read: !!readMap[m.eo_uid] });
      } else {
        answered.push({ ...m, response: r, read: !!readMap[m.eo_uid] });
      }
    });

    // 締切表示
    let deadlineHtml = '';
    if (msg.survey_deadline) {
      const d = new Date(msg.survey_deadline);
      const isExpired = Date.now() > d.getTime();
      const youbi = ['日','月','火','水','木','金','土'][d.getDay()];
      const m2 = d.getMonth() + 1;
      const day = d.getDate();
      deadlineHtml = isExpired
        ? `<div style="font-size:12px; color:#c62828; font-weight:600; margin-bottom:8px;">${t('label_closed')} (${m2}/${day}(${youbi}) 23:59)</div>`
        : `<div style="font-size:12px; color:var(--text-mid); margin-bottom:8px;">締切: ${m2}/${day}(${youbi}) 23:59</div>`;
    }

    // セクションごとのHTML生成
    const renderRow = (m, type) => {
      const readMark = m.read
        ? '<span style="font-size:11px; color:#0F6B63;">既読</span>'
        : '<span style="font-size:11px; color:#c62828;">未読</span>';
      let bottomLine = '';
      if (type === 'answered' && m.response) {
        const updated = m.response.updated_at ? formatTime(m.response.updated_at) : '';
        bottomLine = `<div style="font-size:13px; margin-top:4px; padding:6px 8px; background:#E6F0EF; border-left:3px solid #0F6B63; border-radius:4px;">${escHtml(m.response.response_text || '')}</div>`
                   + `<div style="font-size:10px; color:var(--text-light); margin-top:2px;">回答日時: ${updated}</div>`;
      } else if (type === 'na' && m.response) {
        const updated = m.response.updated_at ? formatTime(m.response.updated_at) : '';
        bottomLine = `<div style="font-size:11px; color:var(--text-light); margin-top:4px;">該当なし選択 (${updated})</div>`;
      }
      return `
        <div style="padding:10px 4px; border-bottom:1px solid var(--border);">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="font-size:14px; font-weight:500;">${escHtml(m.display_name)}${m.is_creator ? ' <span style="font-size:10px;background:var(--green);color:white;border-radius:3px;padding:1px 5px;">管理者</span>' : ''}</div>
            ${readMark}
          </div>
          ${bottomLine}
        </div>
      `;
    };

    const sectionUnanswered = `
      <div style="margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; color:#666; margin-bottom:6px; padding:6px 10px; background:#f5f5f5; border-radius:6px;">未回答 (${notAnswered.length}人)</div>
        ${notAnswered.length === 0 ? '<div style="font-size:12px; color:var(--text-light); padding:8px;">該当なし</div>' : notAnswered.map(m => renderRow(m, 'unanswered')).join('')}
      </div>
    `;
    const sectionNA = `
      <div style="margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; color:#5e35b1; margin-bottom:6px; padding:6px 10px; background:#ede7f6; border-radius:6px;">— 該当なし (${notApplicable.length}人)</div>
        ${notApplicable.length === 0 ? '<div style="font-size:12px; color:var(--text-light); padding:8px;">該当なし</div>' : notApplicable.map(m => renderRow(m, 'na')).join('')}
      </div>
    `;
    const sectionAnswered = `
      <div style="margin-bottom:16px;">
        <div style="font-size:13px; font-weight:700; color:#0F6B63; margin-bottom:6px; padding:6px 10px; background:#E6F0EF; border-radius:6px;">回答済み (${answered.length}人)</div>
        ${answered.length === 0 ? '<div style="font-size:12px; color:var(--text-light); padding:8px;">該当なし</div>' : answered.map(m => renderRow(m, 'answered')).join('')}
      </div>
    `;

    content.innerHTML = `
      <div style="padding:10px 12px; background:#f9f9f9; border-radius:6px; margin-bottom:12px; font-size:13px; line-height:1.6; max-height:120px; overflow-y:auto;">${escHtml(msg.body)}</div>
      ${deadlineHtml}
      <div style="font-size:12px; color:var(--text-light); margin-bottom:12px;">合計 ${targetMembers.length}人 (サイネージ除く全現メンバー・送信者含む)</div>
      ${sectionUnanswered}
      ${sectionNA}
      ${sectionAnswered}
    `;
  } catch(e) {
    console.error(e);
    content.innerHTML = '<div style="text-align:center;color:var(--red);padding:24px;">取得に失敗しました: ' + escHtml(e.message || '') + '</div>';
  }
}
