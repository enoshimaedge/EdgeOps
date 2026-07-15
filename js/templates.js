function applyTemplate(text) {
  document.getElementById('compose-body').value = text;
  document.getElementById('compose-body').focus();
}

async function loadGroupTemplates() {
  _groupTemplatesCache = [];
  if (!currentGroup?.id) return _groupTemplatesCache;
  try {
    const { data, error } = await supabase
      .from('group_templates')
      .select('slot, body')
      .eq('group_id', currentGroup.id)
      .eq('kind', 'contact')
      .order('slot', { ascending: true });
    if (error) throw error;
    _groupTemplatesCache = (data || [])
      .map(r => (r.body || '').trim())
      .filter(t => t.length > 0);
  } catch (e) {
    console.error('[templates] load failed', e);
    _groupTemplatesCache = [];
  }
  return _groupTemplatesCache;
}

async function renderTemplateEditor() {
  const section = document.getElementById('template-edit-section');
  const listEl = document.getElementById('template-edit-list');
  if (!section || !listEl) return;
  // 管理者以外には出さない
  if (isCreator !== true) { section.style.display = 'none'; return; }
  section.style.display = '';

  // DBから現在の保存内容を取得
  let rows = [];
  try {
    const { data, error } = await supabase
      .from('group_templates')
      .select('slot, body')
      .eq('group_id', currentGroup.id)
      .eq('kind', 'contact')
      .order('slot', { ascending: true });
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    console.error('[templates] editor load failed', e);
    rows = [];
  }

  // 初期値の決定: DBに1件もなければ業種別TEMPLATESを初期表示(未保存の初期値)
  let initial = new Array(TEMPLATE_MAX_SLOTS).fill('');
  if (rows.length > 0) {
    // 既存登録あり → DBの内容をそのまま枠へ(編集済みを尊重・上書きしない)
    rows.forEach(r => { if (r.slot >= 1 && r.slot <= TEMPLATE_MAX_SLOTS) initial[r.slot - 1] = r.body || ''; });
  } else {
    // 未登録 → 業種別の初期文例を流し込む(保存するまでDBには入らない)
    const ind = currentGroup?.industry;
    const src = (ind && TEMPLATES[ind]) ? TEMPLATES[ind] : [];
    for (let i = 0; i < TEMPLATE_MAX_SLOTS; i++) initial[i] = src[i] || '';
  }

  // 6枠のテキストエリアを描画
  listEl.innerHTML = initial.map((val, i) => `
    <div class="form-group" style="margin-bottom:0;">
      <label class="form-label" style="font-size:11px;">${t('label_template_n', { n: i + 1 })}</label>
      <textarea class="form-textarea" id="tmpl-edit-${i}" maxlength="${TEMPLATE_BODY_MAXLEN}"
        style="min-height:56px;" placeholder="${t('ph_template_empty')}">${escapeHtml(val)}</textarea>
    </div>
  `).join('');
}

async function saveGroupTemplates() {
  const u = await ensureCurrentUser();
  if (!u) { showToast('認証エラーです。アプリを再起動してください。'); return; }
  if (isCreator !== true) { showToast('管理者のみ変更できます'); return; }
  if (!currentGroup?.id) { showToast('グループ情報が取得できません'); return; }

  // 入力収集(trimして空欄判定)
  const rowsToUpsert = [];
  const slotsToDelete = [];
  for (let i = 0; i < TEMPLATE_MAX_SLOTS; i++) {
    const el = document.getElementById('tmpl-edit-' + i);
    const body = ((el?.value) || '').trim();
    const slot = i + 1;
    if (body.length > 0) {
      rowsToUpsert.push({
        group_id: currentGroup.id,
        kind: 'contact',
        slot: slot,
        body: body,
        updated_by: u.eo_uid,
        updated_at: new Date().toISOString()
      });
    } else {
      slotsToDelete.push(slot); // 空欄 → 既存行があれば削除
    }
  }

  try {
    // 空欄枠の既存行を削除(該当があれば)
    if (slotsToDelete.length > 0) {
      const { error: delErr } = await supabase
        .from('group_templates')
        .delete()
        .eq('group_id', currentGroup.id)
        .eq('kind', 'contact')
        .in('slot', slotsToDelete);
      if (delErr) throw delErr;
    }
    // 本文ありの枠をupsert(group_id,kind,slot のUNIQUEで競合更新)
    if (rowsToUpsert.length > 0) {
      const { error: upErr } = await supabase
        .from('group_templates')
        .upsert(rowsToUpsert, { onConflict: 'group_id,kind,slot' });
      if (upErr) throw upErr;
    }
    showToast(t('toast_templates_saved'));
    // 呼び出しUI用キャッシュも更新
    await loadGroupTemplates();
  } catch (e) {
    console.error('[templates] save failed', e);
    showToast('保存に失敗しました。');
  }
}

