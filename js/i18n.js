// js/i18n.js
// JA/EN 言語辞書（第120回・EO-DEC-0120）／名前空間形式
window.EdgeOpsI18n = {
  ja: {
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

    // ── 第120回で追加：切替UI ──
    setting_language:           '表示言語',

    // ── 第120回で追加：主要動的文言（判定8） ──
    priority_urgent:            '至急',
    priority_caution:           '注意',
    priority_notice:            '連絡',
    read_all:                   '全員既読',
    read_count:                 '既読 {read}/{total}',
    day_today:                  '今日',
    day_yesterday:              '昨日',
    date_md:                    '{m}月{d}日',
    date_ymd:                   '{y}年{m}月{d}日',
    label_image:                '画像',
    label_image_exists:         '画像あり',
    label_survey:               'アンケート {answered}/{total}',
    label_closed:               '締切済み',
    btn_load_more:              'もっと見る',
    loading:                    '読み込み中...',
    empty_no_data:              'データがありません',
    error_generic:              'エラーが発生しました',
    btn_retry:                  '再試行',
    hw_action:                  '重要',
    hw_check:                   '通常',
    hw_done:                    '確認要',
    toast_saved:                '保存しました',
    toast_sent:                 '送信しました',
    toast_cancelled:            'キャンセルしました',
    toast_delete_done:          '削除しました',
    toast_load_failed:          '読み込みに失敗しました',
  },
  en: {
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
    toast_enter_new_name:       'Please enter a new display name',

    // ── 第120回で追加：切替UI ──
    setting_language:           'Language',

    // ── 第120回で追加：主要動的文言（判定8） ──
    priority_urgent:            'Urgent',
    priority_caution:           'Caution',
    priority_notice:            'Notice',
    read_all:                   'Read by all',
    read_count:                 'Read {read}/{total}',
    day_today:                  'Today',
    day_yesterday:              'Yesterday',
    date_md:                    '{m}/{d}',
    date_ymd:                   '{y}/{m}/{d}',
    label_image:                'Image',
    label_image_exists:         'Image',
    label_survey:               'Survey {answered}/{total}',
    label_closed:               'Closed',
    btn_load_more:              'Load more',
    loading:                    'Loading...',
    empty_no_data:              'No data',
    error_generic:              'An error occurred',
    btn_retry:                  'Retry',
    hw_action:                  'Important',
    hw_check:                   'Normal',
    hw_done:                    'Confirm',
    toast_saved:                'Saved',
    toast_sent:                 'Sent',
    toast_cancelled:            'Cancelled',
    toast_delete_done:          'Deleted',
    toast_load_failed:          'Failed to load',
  }
};
