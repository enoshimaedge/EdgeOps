/* =====================================================================
 * EdgeOps  js/export.js
 * 第246回 EO-DEC-0246（対応表 順1）／ manager_export_data（CSV出力）
 * 2026/8/16  江の島エッジ合同会社
 *
 * 役割はCSVの整形とZIP化だけである。
 *   ・権限の判定はRPC（manager_export_data）が正である。画面では判定しない。
 *   ・上限10万行の判定もRPC側が正である（EXPORT_TOO_LARGE）。画面側で数えて止めない。
 *   ・エラーは RAISE EXCEPTION の文言をそのまま鍵にする（キー名を推測しない）。
 * ===================================================================== */

/* ---------------------------------------------------------------------
 * 1. 論点C：LINEアプリ内ではファイルを保存できない
 *    ★2026/8/16 の実機確認で不成立と確定した。
 *      iOS 18.7 / Line 26.12.1        → 外部アプリ起動のダイアログが出て保存されない
 *      Android 16 / Line 26.11.0/IAB  → 「ファイルのダウンロードには対応していません」
 *    ★両端末とも Blob・createObjectURL・aタグの download 属性はいずれも
 *      「対応している」と返す。機能検出では判別できないため、LIFF内かどうかで判定する。
 *    ★判定はこの1箇所だけに書く。同じ条件を2か所へ書き写さない。
 * ------------------------------------------------------------------- */
var EXPORT_BLOCKED_IN_LINE = (function () {
  try {
    return !!(window.liff && typeof liff.isInClient === 'function' && liff.isInClient());
  } catch (e) {
    // 取得できないときは「通す」。制御されない経路でボタンが永久に押せなくならないようにする。
    return false;
  }
})();

var EXPORT_BLOCKED_MESSAGE =
  'LINEアプリ内ではファイルを保存できません。パソコンのブラウザで app.edgeops.jp/manager.html を開いて実行してください。';

/* ---------------------------------------------------------------------
 * 2. エラー文言（RAISE EXCEPTION の文言をそのまま鍵にする）
 * ------------------------------------------------------------------- */
var EXPORT_ERROR_MESSAGES = {
  EXPORT_TOO_LARGE:      '対象の件数が多すぎるため出力できません。期間を短くするか、グループ単位で出力してください。',
  NOT_FACILITY_MANAGER:  '権限がありません',
  AUTH_REQUIRED:         'ログインの有効期限が切れています。画面を開き直してください。',
  GROUP_NOT_IN_FACILITY: '選んだグループはこの施設のものではありません',
  FACILITY_NOT_FOUND:    '施設が見つかりません',
  INVALID_INPUT:         '指定した内容が正しくありません。期間の開始と終了を確かめてください。'
};

function exportErrorMessage(error) {
  if (!error) return '出力できませんでした。時間をおいて再度お試しください';
  var code = (error.message || error.code || '') + '';
  for (var key in EXPORT_ERROR_MESSAGES) {
    if (Object.prototype.hasOwnProperty.call(EXPORT_ERROR_MESSAGES, key) && code.indexOf(key) !== -1) {
      return EXPORT_ERROR_MESSAGES[key];
    }
  }
  return '出力できませんでした。時間をおいて再度お試しください';
}

/* ---------------------------------------------------------------------
 * 3. CSVの整形（UTF-8 BOM付き・改行CRLF・RFC4180）
 *    ・null と undefined は空文字にする。文字列 "null" を書き出さない。
 *    ・カンマ・改行・ダブルクォートを含む値は必ずクォートし、" は "" にする。
 * ------------------------------------------------------------------- */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  var s = String(value);
  if (s.indexOf('"') !== -1 || s.indexOf(',') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(columns, rows) {
  var lines = [];
  lines.push(columns.map(csvCell).join(','));
  var list = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i] || {};
    var cells = [];
    for (var j = 0; j < columns.length; j++) {
      cells.push(csvCell(row[columns[j]]));
    }
    lines.push(cells.join(','));
  }
  // ★BOMが無いとExcelで日本語が化ける。改行はCRLF。
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/* ---------------------------------------------------------------------
 * 4. CSV 9本の定義（キー名はRPCの戻り値と1対1で対応させること）
 * ------------------------------------------------------------------- */
var EXPORT_CSV_DEFS = [
  { file: 'facility.csv', key: 'facility', columns: [
    'facility_code', 'facility_name', 'industry', 'region', 'plan',
    'contract_status', 'created_at', 'updated_at' ] },

  { file: 'groups.csv', key: 'groups', columns: [
    'group_id', 'group_name', 'industry', 'region', 'created_at',
    'expires_at', 'archived_at', 'max_members', 'gid_masked', 'signage_enabled' ] },

  { file: 'members.csv', key: 'members', columns: [
    'member_key', 'display_name', 'group_id', 'status',
    'is_creator', 'is_signage', 'created_at', 'approved_at' ] },

  { file: 'membership_events.csv', key: 'membership_events', columns: [
    'member_key', 'display_name', 'group_id', 'event_type', 'occurred_at' ] },

  { file: 'messages.csv', key: 'messages', columns: [
    'message_id', 'group_id', 'sender_member_key', 'sender_display_name',
    'body', 'priority', 'is_survey', 'survey_deadline', 'is_deleted',
    'root_post_id', 'read_count', 'receiver_count', 'image_mode',
    'image_uploaded_at', 'image_deleted_at', 'image_size', 'created_at' ] },

  { file: 'read_receipts.csv', key: 'read_receipts', columns: [
    'message_id', 'member_key', 'display_name', 'read_at' ] },

  { file: 'handover_notes.csv', key: 'handover_notes', columns: [
    'handover_id', 'group_id', 'sender_member_key', 'sender_display_name',
    'content', 'priority', 'image_mode', 'image_uploaded_at',
    'image_deleted_at', 'image_size', 'created_at' ] },

  { file: 'handover_confirmations.csv', key: 'handover_confirmations', columns: [
    'handover_id', 'member_key', 'display_name', 'action', 'confirmed_at' ] },

  { file: 'message_responses.csv', key: 'message_responses', columns: [
    'message_id', 'member_key', 'display_name', 'status', 'response_text', 'updated_at' ] }
];

/* ---------------------------------------------------------------------
 * 5. _README.txt（省く経路を作らない＝読み方を必ず同梱する）
 * ------------------------------------------------------------------- */
function buildReadme(meta) {
  var m = meta || {};
  var lines = [
    'EdgeOps データ出力',
    '',
    '出力日時   : ' + (m.exported_at || ''),
    '対象施設   : ' + (m.facility_code || ''),
    '対象範囲   : ' + (m.scope === 'group' ? 'グループ単位' : '施設全体'),
    '期間       : ' + ((m.period_from || m.period_to)
                        ? ((m.period_from || '（指定なし）') + ' 〜 ' + (m.period_to || '（指定なし）'))
                        : '全期間'),
    '合計行数   : ' + (m.total_rows == null ? '' : m.total_rows),
    '',
    '───────────────────────────────',
    '読むときの注意',
    '───────────────────────────────',
    '',
    '1. member_key はこの出力の中だけで通じる連番です。',
    '   別の日に出した出力の member_key とは突き合わせられません。',
    '   個人を識別する内部IDは、どのCSVにも出していません。',
    '',
    '2. image_mode の読み方',
    '     expandable … 画像があります',
    '     deleted    … 画像はありましたが、保存期限を過ぎて削除済みです',
    '     （空）     … 画像はありません',
    '   画像そのもののURL（image_url）は出していません。',
    '',
    '3. image_deleted_at に日時が入っていれば、「画像が存在した」証跡になります。',
    '',
    '4. 台帳（facility.csv / groups.csv / members.csv）は、',
    '   期間を指定した場合でも全件です。期間は出来事にだけ効きます。',
    '',
    '5. read_receipts.csv は read_at が期間内のものだけです。',
    '   期間内の連絡でも、期間外に読まれた既読は入りません。',
    '',
    '6. messages.csv / handover_notes.csv の sender_display_name は現在の表示名です。',
    '   退出済みの方の当時の名前は membership_events.csv の display_name を見てください。',
    '',
    '7. 同梱のCSVは9本です。',
    '   facility / groups / members / membership_events / messages /',
    '   read_receipts / handover_notes / handover_confirmations / message_responses',
    ''
  ];
  return '﻿' + lines.join('\r\n');
}

/* ---------------------------------------------------------------------
 * 6. ファイル名と保存
 * ------------------------------------------------------------------- */
function exportStamp() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate())
       + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function saveBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 2000);
}

/* ---------------------------------------------------------------------
 * 7. 期間の指定を timestamptz へ直す
 *    RPC側は p_to を「未満」で比べるため、終了日はその翌日の0時を渡す。
 * ------------------------------------------------------------------- */
function exportDateToIsoStart(value) {
  if (!value) return null;
  var parts = String(value).split('-');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0);
  return d.toISOString();
}

function exportDateToIsoEnd(value) {
  if (!value) return null;
  var parts = String(value).split('-');
  if (parts.length !== 3) return null;
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1, 0, 0, 0, 0);
  return d.toISOString();
}

/* ---------------------------------------------------------------------
 * 8. 出力の本体
 * ------------------------------------------------------------------- */
var exportRunning = false;

function setExportMessage(text, isError) {
  var el = document.getElementById('export-message');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = isError ? '#c0392b' : '#555';
}

async function runExport() {
  if (exportRunning) return;
  if (EXPORT_BLOCKED_IN_LINE) { setExportMessage(EXPORT_BLOCKED_MESSAGE, true); return; }
  if (typeof JSZip === 'undefined') {
    setExportMessage('ZIPの作成に必要な部品を読み込めませんでした。通信環境を確かめて画面を開き直してください。', true);
    return;
  }

  var facility = (typeof getSelectedFacility === 'function') ? getSelectedFacility() : null;
  if (!facility) { setExportMessage('施設が選ばれていません', true); return; }

  var scopeEl = document.getElementById('export-scope');
  var fromEl  = document.getElementById('export-from');
  var toEl    = document.getElementById('export-to');
  var btn     = document.getElementById('export-run-btn');

  var groupSessionId = (scopeEl && scopeEl.value) ? scopeEl.value : null;
  var from = exportDateToIsoStart(fromEl ? fromEl.value : '');
  var to   = exportDateToIsoEnd(toEl ? toEl.value : '');

  exportRunning = true;
  if (btn) btn.disabled = true;
  setExportMessage('出力しています。しばらくお待ちください…', false);

  try {
    var res = await sb.rpc('manager_export_data', {
      p_facility_id: facility.facility_id,
      p_group_session_id: groupSessionId,
      p_from: from,
      p_to: to
    });
    if (res.error) { setExportMessage(exportErrorMessage(res.error), true); return; }

    var data = res.data || {};
    var zip = new JSZip();

    for (var i = 0; i < EXPORT_CSV_DEFS.length; i++) {
      var def = EXPORT_CSV_DEFS[i];
      zip.file(def.file, buildCsv(def.columns, data[def.key]));
    }
    zip.file('_README.txt', buildReadme(data.meta));

    var blob = await zip.generateAsync({ type: 'blob' });
    var code = (data.meta && data.meta.facility_code) ? data.meta.facility_code : 'export';
    saveBlob(blob, 'edgeops_' + code + '_' + exportStamp() + '.zip');

    var total = (data.meta && data.meta.total_rows != null) ? data.meta.total_rows : '';
    setExportMessage('出力しました（合計 ' + total + ' 行 / CSV 9本 + _README.txt）。', false);
  } catch (e) {
    setExportMessage(exportErrorMessage(e), true);
  } finally {
    exportRunning = false;
    if (btn) btn.disabled = false;
  }
}

/* ---------------------------------------------------------------------
 * 9. 画面（manager.html は js/i18n.js を読み込んでいないため日本語の直書き）
 * ------------------------------------------------------------------- */
function renderExportSection() {
  var container = document.getElementById('export-container');
  if (!container) return;
  container.replaceChildren();

  var facility = (typeof getSelectedFacility === 'function') ? getSelectedFacility() : null;
  if (!facility) return;

  var header = document.createElement('div');
  header.className = 'mg-group-card-header';
  var title = document.createElement('div');
  title.className = 'mg-group-card-title';
  title.textContent = 'データ出力（CSV）';
  header.appendChild(title);
  container.appendChild(header);

  var note = document.createElement('div');
  note.style.fontSize = '12px';
  note.style.color = '#666';
  note.style.margin = '4px 0 12px';
  note.textContent = 'この施設の記録をCSV（9本）とREADMEにまとめ、ZIPで保存します。'
                   + '個人を識別する内部IDと画像そのものは含みません。';
  container.appendChild(note);

  // 対象
  var scopeLabel = document.createElement('label');
  scopeLabel.className = 'mg-group-form-label';
  scopeLabel.textContent = '対象';
  container.appendChild(scopeLabel);

  var scope = document.createElement('select');
  scope.id = 'export-scope';
  scope.className = 'mg-group-select';
  var optAll = document.createElement('option');
  optAll.value = '';
  optAll.textContent = '施設全体';
  scope.appendChild(optAll);

  var groups = (typeof managerGroups !== 'undefined' && Array.isArray(managerGroups))
    ? managerGroups.filter(function (g) {
        return String(g.facility_id) === String(facility.facility_id);
      })
    : [];
  groups.forEach(function (g) {
    var o = document.createElement('option');
    o.value = g.group_session_id;
    o.textContent = (g.group_name || g.group_id) + (g.archived_at ? '（アーカイブ済み）' : '');
    scope.appendChild(o);
  });
  container.appendChild(scope);

  // 期間
  var periodLabel = document.createElement('label');
  periodLabel.className = 'mg-group-form-label';
  periodLabel.textContent = '期間（空欄なら全期間）';
  container.appendChild(periodLabel);

  var periodWrap = document.createElement('div');
  periodWrap.style.display = 'flex';
  periodWrap.style.gap = '8px';
  periodWrap.style.alignItems = 'center';
  periodWrap.style.flexWrap = 'wrap';

  var from = document.createElement('input');
  from.type = 'date';
  from.id = 'export-from';
  from.className = 'mg-group-input';
  from.style.flex = '1 1 140px';
  periodWrap.appendChild(from);

  var tilde = document.createElement('span');
  tilde.textContent = '〜';
  periodWrap.appendChild(tilde);

  var to = document.createElement('input');
  to.type = 'date';
  to.id = 'export-to';
  to.className = 'mg-group-input';
  to.style.flex = '1 1 140px';
  periodWrap.appendChild(to);
  container.appendChild(periodWrap);

  var periodNote = document.createElement('div');
  periodNote.style.fontSize = '12px';
  periodNote.style.color = '#666';
  periodNote.style.margin = '6px 0 12px';
  periodNote.textContent = '期間は連絡・引き継ぎ・既読などの「出来事」にだけ効きます。'
                         + '施設・グループ・メンバーの一覧は期間に関わらず全件です。';
  container.appendChild(periodNote);

  // 実行
  var actions = document.createElement('div');
  actions.className = 'mg-group-form-actions';

  var run = document.createElement('button');
  run.type = 'button';
  run.id = 'export-run-btn';
  run.className = 'mg-group-btn mg-group-btn-primary';
  run.textContent = 'ZIPで書き出す';
  run.addEventListener('click', function () { runExport(); });
  actions.appendChild(run);
  container.appendChild(actions);

  var msg = document.createElement('div');
  msg.id = 'export-message';
  msg.style.fontSize = '12px';
  msg.style.marginTop = '8px';
  msg.style.minHeight = '16px';
  msg.style.color = '#555';
  container.appendChild(msg);

  // ★論点C：LINEアプリ内では保存できないため、実行ボタンを無効化して理由を出す
  if (EXPORT_BLOCKED_IN_LINE) {
    run.disabled = true;
    run.title = EXPORT_BLOCKED_MESSAGE;
    setExportMessage(EXPORT_BLOCKED_MESSAGE, true);
  }
}
