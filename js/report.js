async function showMonthlyReport() {
  document.getElementById('modal-report').style.display = 'block';
  currentReportTab = 'last';
  updateReportTabUI();
  await loadReportData('last');
}

function switchReportTab(tab) {
  currentReportTab = tab;
  updateReportTabUI();
  loadReportData(tab);
}


async function loadReportData(tab) {
  const content = document.getElementById('report-content');
  const periodEl = document.getElementById('report-period');
  content.innerHTML = '<div class="spinner" style="margin:40px auto;"></div>';

  const now = new Date();
  // JSTオフセット（+9時間）を考慮
  const jstOffset = 9 * 60 * 60 * 1000;
  const nowJST = new Date(now.getTime() + jstOffset);
  let year, month;
  if (tab === 'last') {
    const d = new Date(Date.UTC(nowJST.getUTCFullYear(), nowJST.getUTCMonth() - 1, 1));
    year = d.getUTCFullYear(); month = d.getUTCMonth();
  } else {
    year = nowJST.getUTCFullYear(); month = nowJST.getUTCMonth();
  }
  // JSTの月初・月末をUTCに変換してクエリ
  const start = new Date(Date.UTC(year, month, 1) - jstOffset).toISOString();
  const end   = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59) - jstOffset).toISOString();
  const label = `${year}年${month + 1}月`;
  periodEl.textContent = label;

  try {
    // メッセージ取得
    const { data: msgs } = await supabase
      .from('messages')
      .select('id, created_at, sender_eo_uid, read_count')
      .eq('group_session_id', currentGroup.id)
      .gte('created_at', start).lte('created_at', end)
      .neq('is_survey', true);

    // 既読レコード取得
    const msgIds = (msgs || []).map(m => m.id);
    let receipts = [];
    if (msgIds.length > 0) {
      const { data } = await supabase
        .from('read_receipts')
        .select('message_id, eo_uid, read_at')
        .in('message_id', msgIds);
      receipts = data || [];
    }

    // メンバー取得
    const { data: members } = await supabase
      .from('group_members')
      .select('id, display_name, eo_uid, is_signage')
      .eq('group_session_id', currentGroup.id)
      .eq('status', 'approved');
    const humanMembers = (members || []).filter(m => !m.is_signage);
    const memberCount = humanMembers.length;
    const memberMap = {};
    humanMembers.forEach(m => { memberMap[m.eo_uid] = m.display_name; });

    // 統計計算
    const totalMsgs = (msgs || []).length;

    // 平均既読率（送信時点のreceiver_countを使用・メンバー増減の影響を受けない）
    let totalRate = 0;
    (msgs || []).forEach(msg => {
      const msgReceipts = receipts.filter(r => r.message_id === msg.id && r.eo_uid !== msg.sender_eo_uid && memberMap[r.eo_uid]);
      // receiver_countが保存済みならそれを使う（送信時点で固定）
      // NULLの場合（旧メッセージ）は現在のサイネージ除外メンバー数から計算
      const receiverCount = msg.receiver_count != null ? msg.receiver_count : memberCount - 1;
      totalRate += receiverCount > 0 ? msgReceipts.length / receiverCount : 0;
    });
    const avgRate = totalMsgs > 0 ? Math.round(totalRate / totalMsgs * 100) : 0;

    // 最速既読者（全メッセージで最も平均既読時間が短いメンバー）- サイネージ除外
    const memberReadTimes = {};
    const memberReadCounts = {};
    receipts.forEach(r => {
      if (!memberMap[r.eo_uid]) return; // サイネージまたは退出済みを除外
      const msg = (msgs || []).find(m => m.id === r.message_id);
      if (!msg) return;
      const diff = (new Date(r.read_at) - new Date(msg.created_at)) / 60000;
      if (!memberReadTimes[r.eo_uid]) { memberReadTimes[r.eo_uid] = 0; memberReadCounts[r.eo_uid] = 0; }
      memberReadTimes[r.eo_uid] += diff;
      memberReadCounts[r.eo_uid]++;
    });
    let fastestName = '—'; let fastestMin = Infinity;
    Object.keys(memberReadTimes).forEach(uid => {
      const avg = memberReadTimes[uid] / memberReadCounts[uid];
      if (avg < fastestMin) { fastestMin = avg; fastestName = memberMap[uid] || '—'; }
    });
    const fastestStr = fastestMin < Infinity
      ? `${fastestName}（平均${fastestMin < 60 ? Math.round(fastestMin) + '分' : Math.round(fastestMin/60) + '時間'}）`
      : '—';

    // 要注意スタッフ（既読率50%未満）- サイネージ除外
    const memberRateMap = {};
    humanMembers.forEach(m => { memberRateMap[m.eo_uid] = { name: m.display_name, read: 0, total: 0 }; });
    (msgs || []).forEach(msg => {
      const msgReceipts = receipts.filter(r => r.message_id === msg.id);
      humanMembers.forEach(m => {
        if (m.eo_uid === msg.sender_eo_uid) return; // 送信者は除く
        memberRateMap[m.eo_uid].total++;
        if (msgReceipts.find(r => r.eo_uid === m.eo_uid)) memberRateMap[m.eo_uid].read++;
      });
    });
    const caution = Object.values(memberRateMap)
      .filter(m => m.total > 0 && m.read / m.total < 0.5)
      .sort((a, b) => (a.read/a.total) - (b.read/b.total)); // 既読率が低い順

    // レポートHTML生成
    // Design System v1.13: カード背景は単色の白。角丸9px。赤は「至急」のみ。
    const rateColor = avgRate >= 60 ? 'var(--eo-text)' : 'var(--eo-priority-caution)';
    content.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
        <div style="background:var(--eo-surface); border:1px solid var(--eo-border); border-radius:var(--eo-radius); padding:14px; text-align:center;">
          <div style="font-size:11px; color:var(--eo-text-muted); margin-bottom:4px;">送信メッセージ数</div>
          <div style="font-size:28px; font-weight:700; color:var(--eo-text);">${totalMsgs}</div>
          <div style="font-size:11px; color:var(--eo-text-muted);">件</div>
        </div>
        <div style="background:var(--eo-surface); border:1px solid var(--eo-border); border-radius:var(--eo-radius); padding:14px; text-align:center;">
          <div style="font-size:11px; color:var(--eo-text-muted); margin-bottom:4px;">平均既読率</div>
          <div style="font-size:28px; font-weight:700; color:${rateColor};">${avgRate}</div>
          <div style="font-size:11px; color:var(--eo-text-muted);">%</div>
        </div>
      </div>
      <div style="background:var(--eo-surface); border:1px solid var(--eo-border); border-radius:var(--eo-radius); padding:14px; margin-bottom:10px;">
        <div style="font-size:11px; font-weight:700; color:var(--eo-text-muted); margin-bottom:6px;">最速既読者</div>
        <div style="font-size:14px; font-weight:600; color:var(--eo-text);">${fastestStr}</div>
      </div>
      <div style="background:var(--eo-surface); border:1px solid var(--eo-border); border-radius:var(--eo-radius); padding:14px;">
        <div style="font-size:11px; font-weight:700; color:var(--eo-text-muted); margin-bottom:6px;">要注意スタッフ（既読率50%未満）</div>
        ${caution.length === 0
          ? '<div style="font-size:13px; color:var(--eo-text-muted);">該当者なし</div>'
          : caution.map(m => {
              const r = m.total > 0 ? Math.round(m.read / m.total * 100) : 0;
              return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid var(--eo-border);">
                <span style="font-size:13px; font-weight:500; color:var(--eo-text);">${escHtml(m.name)}</span>
                <span style="font-size:13px; font-weight:700; color:var(--eo-priority-caution);">${r}%</span>
              </div>`;
            }).join('')
        }
      </div>
      ${totalMsgs === 0 ? '<div style="text-align:center; color:var(--eo-text-muted); font-size:13px; margin-top:16px;">この月のメッセージはありません</div>' : ''}
    `;
  } catch(e) {
    console.error(e);
    content.innerHTML = '<div style="text-align:center; color:var(--red); padding:20px;">データの取得に失敗しました</div>';
  }
}
