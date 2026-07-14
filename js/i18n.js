// js/i18n.js
// 【将来用・この時点では読み込まない。定義のみ。】
// JA/EN 切替機能を実装するときに再利用します。
// index.html から削除した日英対訳の退避ファイル（Step 4）

export const ja = {
  // ── アプリ共通 ──────────────────────────────────────────────
  app_sub:                    '業務連絡支援アプリ',

  // ── 友だち未登録画面 ─────────────────────────────────────────
  desc_add_friend:            'EdgeOpsを利用するには、まずEEE｜EdgeOpsを友だち登録してください。',
  btn_add_friend:             '友だち追加する',
  btn_recheck:                '登録済みの場合は再確認',

  // ── 起動・グループ選択（登録開始）画面 ──────────────────────────
  heading_get_started:        'はじめましょう',
  desc_get_started:           'グループを作成するか、既存のグループに参加してください',
  form_display_name:          '表示名（本名を入力してください）',
  heading_create_group:       '新しいグループを作る',
  form_group_name:            'グループ名（任意）',
  form_industry:              '業種を選択',
  form_region:                '地域を選択（任意）',
  label_or:                   'または',
  form_group_id_join:         'グループIDを入力して参加',
  btn_use_as_signage:         'サイネージとして利用する',
  btn_join:                   'グループに参加する',
  link_terms:                 '利用規約',
  link_privacy:               'プライバシーポリシー',

  // ── 他グループ追加参加画面 ────────────────────────────────────
  header_sub_add_group:       '既存グループはそのまま保持されます',
  desc_group_id_join:         'グループの管理者から共有されたIDを入力します',
  form_display_name_group:    '表示名(このグループでの名前)',
  form_group_id:              'グループID',

  // ── 承認待ち画面 ─────────────────────────────────────────────
  heading_pending:            '参加申請中',
  status_waiting:             '承認を待っています',
  desc_waiting:               'グループメンバーが承認すると自動的に参加できます',
  label_applied_group_id:     '参加申請したグループID',
  btn_check_status:           '承認状況を確認する',
  btn_cancel_request:         '申請を取り消す',

  // ── ホーム画面 ───────────────────────────────────────────────
  filter_messages:            '連絡',
  filter_handover:            '引き継ぎ',
  filter_all:                 'すべて',
  btn_new_message:            '新しい連絡',
  empty_no_messages:          'まだメッセージがありません',

  // ── 連絡投稿画面 ─────────────────────────────────────────────
  header_sub_compose:         '新しい連絡',
  btn_type_msg:               '通常メッセージ',
  btn_type_handover:          '引き継ぎノート',
  form_priority:              '優先度',
  form_handover_type:         '引き継ぎ種別',
  form_templates:             'テンプレートから選ぶ',
  form_message_body:          'メッセージ内容',
  form_handover_body:         '引き継ぎ内容',
  btn_take_photo:             '写真を撮る',
  btn_choose_photo:           '写真を選ぶ',
  btn_send:                   '送信する',

  // ── メッセージ詳細画面 ───────────────────────────────────────
  btn_delete_message:         'このメッセージを削除する',

  // ── 引き継ぎノート画面 ───────────────────────────────────────
  header_sub_handover:        '引き継ぎノート',
  btn_handover_takeover:      '引き継ぎました',
  btn_handover_done:          '対応しました',

  // ── 承認管理画面 ─────────────────────────────────────────────
  header_sub_approvals:       '参加申請の承認',
  banner_approval_request:    'グループへの参加申請が届いています',
  banner_approval_info:       '承認すると参加できます',
  empty_no_pending:           '承認待ちのメンバーはいません',
  btn_approve:                '承認',
  btn_reject:                 '却下',

  // ── 設定画面（グループ） ──────────────────────────────────────
  form_change_group_name:     'グループ名を変更',
  btn_update_group_name:      'グループ名を更新',
  form_change_industry:       '業種を変更',
  btn_update_industry:        '業種を更新',
  btn_monthly_report:         '月次レポートを見る',
  btn_member_list:            'メンバー一覧',
  btn_survey_results:         'アンケート集計結果',
  btn_save:                   '保存',
  heading_templates:          '連絡メッセージ テンプレ',
  btn_save_templates:         'テンプレを保存',

  // ── 設定画面（プロフィール） ───────────────────────────────────
  header_sub_profile:         'プロフィール・設定',
  form_change_display_name:   '表示名を変更',
  placeholder_new_name:       '新しい表示名',
  btn_update_name:            '表示名を更新',
  btn_leave_group:            'グループを退出する',

  // ── トースト・バリデーションメッセージ（JS） ─────────────────────
  toast_cancel_request:       '申請を取り消しました',
  toast_enter_new_name:       '新しい表示名を入力してください',
};

export const en = {
  // ── アプリ共通 ──────────────────────────────────────────────
  app_sub:                    'EdgeOperations',

  // ── 友だち未登録画面 ─────────────────────────────────────────
  desc_add_friend:            'Please add EEE｜EdgeOps as a friend first.',
  btn_add_friend:             'Add Friend',
  btn_recheck:                'Re-check',

  // ── 起動・グループ選択（登録開始）画面 ──────────────────────────
  heading_get_started:        'Get Started',
  desc_get_started:           'Create or join a group',
  form_display_name:          'Display Name',
  heading_create_group:       'Create Group',
  form_group_name:            'Group Name',
  form_industry:              'Industry',
  form_region:                'Region',
  label_or:                   'or',
  form_group_id_join:         'Join with Group ID',
  btn_use_as_signage:         'Use as Signage',
  btn_join:                   'Join',
  link_terms:                 'Terms of Service',
  link_privacy:               'Privacy Policy',

  // ── 他グループ追加参加画面 ────────────────────────────────────
  header_sub_add_group:       'Join another group',
  desc_group_id_join:         'Enter the group ID shared by the admin',
  form_display_name_group:    'Display Name in this Group',
  form_group_id:              'Group ID',

  // ── 承認待ち画面 ─────────────────────────────────────────────
  heading_pending:            'Pending Approval',
  status_waiting:             'Waiting for Approval',
  desc_waiting:               'A member will approve your request',
  label_applied_group_id:     'Group ID',
  btn_check_status:           'Check Status',
  btn_cancel_request:         'Cancel Request',

  // ── ホーム画面 ───────────────────────────────────────────────
  filter_messages:            'Messages',
  filter_handover:            'Handover',
  filter_all:                 'All',
  btn_new_message:            'New Message',
  empty_no_messages:          'No messages yet',

  // ── 連絡投稿画面 ─────────────────────────────────────────────
  header_sub_compose:         'New Message',
  btn_type_msg:               'Message',
  btn_type_handover:          'Handover',
  form_priority:              'Priority',
  form_handover_type:         'Handover Type',
  form_templates:             'Templates',
  form_message_body:          'Message',
  form_handover_body:         'Handover Content',
  btn_take_photo:             'Take Photo',
  btn_choose_photo:           'Choose Photo',
  btn_send:                   'Send',

  // ── メッセージ詳細画面 ───────────────────────────────────────
  btn_delete_message:         'Delete',

  // ── 引き継ぎノート画面 ───────────────────────────────────────
  header_sub_handover:        'Handover Notes',
  btn_handover_takeover:      'Took Over',
  btn_handover_done:          'Completed',

  // ── 承認管理画面 ─────────────────────────────────────────────
  header_sub_approvals:       'Member Approval',
  banner_approval_request:    'Member approval requests',
  banner_approval_info:       'Approve to allow joining',
  empty_no_pending:           'No pending requests',
  btn_approve:                'Approve',
  btn_reject:                 'Reject',

  // ── 設定画面（グループ） ──────────────────────────────────────
  form_change_group_name:     'Group Name',
  btn_update_group_name:      'Update',
  form_change_industry:       'Change Industry',
  btn_update_industry:        'Update Industry',
  btn_monthly_report:         'Monthly Report',
  btn_member_list:            'Member List',
  btn_survey_results:         'Survey Results',
  btn_save:                   'Save',
  heading_templates:          'Templates',
  btn_save_templates:         'Save Templates',

  // ── 設定画面（プロフィール） ───────────────────────────────────
  header_sub_profile:         'Profile & Settings',
  form_change_display_name:   'Change Display Name',
  placeholder_new_name:       'New display name',
  btn_update_name:            'Update Name',
  btn_leave_group:            'Leave Group',

  // ── トースト・バリデーションメッセージ（JS） ─────────────────────
  toast_cancel_request:       'Request cancelled',
  toast_enter_new_name:       'New display name',
};
