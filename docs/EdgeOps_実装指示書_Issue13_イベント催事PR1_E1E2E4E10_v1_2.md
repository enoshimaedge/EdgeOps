# EdgeOps 実装指示書：Issue⑬ イベント・催事モード PR1（E1・E2・E4・E10）

**版**：v1.2 ／ **作成**：2026/7/25 ／ **改訂**：2026/7/26
**根拠**：チャッピー第154回判定（EO-DEC-0154・条件付きGO）
**正本**：`EdgeOps_ST版イベント催事モード仕様書_v1_5.docx` 第3-1章・第4章・第5章・第8章・第14章・第22章
**切り戻しタグ**：マージ前に `pre-event-pr1` を作成すること

### 改訂記録

| 版 | 日付 | 内容 |
|---|---|---|
| v1.0 | 7/25 | 初版（`docs/` にアップロード済み） |
| **v1.2** | **7/26** | **6-2章を新設**（`currentGroup.max_members` の差し替え漏れを修正）。正本を v1.5 へ更新。第10章のグループ名を実態に合わせ、顧客本番グループの除外を明記 |

> **★版番号について**：7/25の記録では v1.1 を作成したとあるが、`docs/` に存在するのは v1.0 である。
> 混同を避けるため本書は **v1.2** とした。**手元に v1.1 が見つかった場合は、本書との差分を必ず確認すること。**

---

## 0. 変更対象ファイル（この2つ以外は1文字も変更しないこと）

| # | ファイル | 変更内容 |
|---|---|---|
| 1 | `index.html` | HTML追加2箇所・JS変更7箇所（★v1.2で 6-2章 を追加） |
| 2 | `js/i18n.js` | ja/en に各13キー追加（既存164キーは変更しない） |

**`js/` 配下の他4ファイル（ui-helpers.js・image.js・templates.js・survey.js・report.js）・`auth.js`・`signage.html`・`admin.html` は変更しない。**
**新規JSファイルを作成しないこと。ローカル関数のグローバル昇格を行わないこと。**

---

## 1. 最優先制約（第0章）

**実顧客が本番稼働中である。通常グループ（`industry !== 'event'`）の挙動を1ミリも変更しないこと。**
すべての分岐は `industry === 'event'` の真偽で行い、偽の場合は現行と完全に同一の経路を通ること。

---

## 2. 【E2/E1】`js/i18n.js` へキーを追加

`ja` ブロックの末尾（`time_min_ago` の直後）と、`en` ブロックの末尾（同じく `time_min_ago` の直後）に、それぞれ以下を追加する。**既存164キーの値は一切変更しない。**

### ja に追加

```js
    // ── イベント・催事モード（Issue⑬で追加）──────────────────────
    heading_create_group_event:  '新しいイベントを作る',
    form_group_id_join_event:    'イベントコードを入力して参加',
    desc_group_id_join_event:    'イベントの主催者から共有されたコードを入力します',
    form_group_id_event:         'イベントコード',
    label_applied_group_id_event:'参加申請したイベントコード',
    label_your_group_id_event:   'あなたのイベントコード',
    form_event_last_day:         '利用できる最終日',
    desc_event_last_day:         '選択した日の翌日から、このグループは利用できなくなります',
    toast_event_last_day_required:'利用できる最終日を選択してください',
    toast_event_last_day_past:   '本日以降の日付を選択してください',
    toast_group_full:            'このグループは満員です',
    notice_event_ended_title:    'このイベントは終了しました',
    notice_event_ended_body:     '新しいイベントに参加するか、新規作成してください。',
```

### en に追加

```js
    // ── イベント・催事モード（Issue⑬で追加）──────────────────────
    heading_create_group_event:  'Create Event',
    form_group_id_join_event:    'Join with Event Code',
    desc_group_id_join_event:    'Enter the event code shared by the organizer',
    form_group_id_event:         'Event Code',
    label_applied_group_id_event:'Event Code',
    label_your_group_id_event:   'Your Event Code',
    form_event_last_day:         'Last day of use',
    desc_event_last_day:         'This group becomes unavailable the day after the selected date.',
    toast_event_last_day_required:'Please select the last day of use.',
    toast_event_last_day_past:   'Please select today or a later date.',
    toast_group_full:            'This group is full',
    notice_event_ended_title:    'This event has ended',
    notice_event_ended_body:     'Join a new event or create one.',
```

### キャッシュ更新

`index.html` L901 のバージョン文字列を更新する。**L902 の `ui-helpers.js` は変更しない。**

```html
<!-- 変更前 -->
<script src="js/i18n.js?v=20260724-1"></script>   <!-- ← 追加。必ず最初 -->
<!-- 変更後 -->
<script src="js/i18n.js?v=20260725-1"></script>   <!-- ← 追加。必ず最初 -->
```

---

## 3. 【E1】期限入力UIをHTMLへ追加

`index.html` の業種選択ブロック（L199〜211）の**直後**、地域選択ブロック（L212〜）の**直前**に挿入する。

```html
        <!-- ══ [Issue⑬ E1] イベント・催事の期限入力（event選択時のみ表示） ══ -->
        <div class="form-group" id="form-group-event-expiry" style="display:none; margin-bottom:12px;">
          <label class="form-label"><span data-i18n="form_event_last_day">利用できる最終日</span></label>
          <input class="form-input" id="input-event-last-day" type="date">
          <div style="font-size:11px; color:var(--text-light); margin-top:6px;"
               data-i18n="desc_event_last_day">選択した日の翌日から、このグループは利用できなくなります</div>
        </div>
```

---

## 4. 【E10】期限切れ通知（イベント用）をHTMLへ追加

`index.html` L180〜182 の `start-expiry-notice` の**直後**に、イベント用の通知を追加する。
**既存の `start-expiry-notice` は文言・スタイルとも一切変更しない**（通常グループ用として現行のまま使う）。

```html
    <div id="start-expiry-notice-event" style="display:none; background:#fff3e0; border-left:4px solid #f57c00; color:#7c4a00; padding:14px 16px; margin-bottom:16px; border-radius:6px; font-size:14px; line-height:1.6;">
      <span data-i18n="notice_event_ended_title">このイベントは終了しました</span><br><span data-i18n="notice_event_ended_body">新しいイベントに参加するか、新規作成してください。</span>
    </div>
```

---

## 5. 【E2】文言差し替えの仕組みを追加

`index.html` の `updateLangButtons()` 関数（L967〜971）の**直後**、`DOMContentLoaded` リスナ（L972〜)の**直前**に、以下を追加する。

```js
// ════════════════════════════════════════════════════════════
// [Issue⑬ E2] イベント・催事モードの文言差し替え（第154回判定）
//   data-i18n 属性の値そのものを差し替える方式。
//   これにより setLang() → applyLang() が再実行されても
//   イベント表記が維持される（言語切替でJA/ENが戻らない）。
// ════════════════════════════════════════════════════════════
const EVENT_I18N_PAIRS = [
  ['heading_create_group',   'heading_create_group_event'],
  ['form_group_id_join',     'form_group_id_join_event'],
  ['desc_group_id_join',     'desc_group_id_join_event'],
  ['form_group_id',          'form_group_id_event'],
  ['label_applied_group_id', 'label_applied_group_id_event'],
  ['label_your_group_id',    'label_your_group_id_event'],
];

function applyEventWording(isEvent) {
  EVENT_I18N_PAIRS.forEach(([base, ev]) => {
    const from = isEvent ? base : ev;
    const to   = isEvent ? ev   : base;
    document.querySelectorAll(`[data-i18n="${from}"]`).forEach(el => {
      el.dataset.i18n = to;
    });
  });
  applyLang(getCurrentLang());
}

// 業種プルダウンの変更で、期限入力UIと文言を同時に切り替える（第3-1章・第5章）
function onIndustryChanged() {
  const v = document.getElementById('input-industry')?.value || '';
  const isEvent = (v === 'event');
  const box = document.getElementById('form-group-event-expiry');
  if (box) box.style.display = isEvent ? 'block' : 'none';
  applyEventWording(isEvent);
}
```

### 業種プルダウンへ onchange を付与

`index.html` L201 を変更する。**option の中身は変更しない。**

```html
<!-- 変更前 -->
          <select class="form-input" id="input-industry">
<!-- 変更後 -->
          <select class="form-input" id="input-industry" onchange="onIndustryChanged()">
```

### グループ確定後に文言を同期する

**次の5箇所すべて**に、`currentGroup` への代入が完了した**直後**に1行を追加する。順序を守ること（`currentGroup` 未設定で呼ぶと誤判定する）。

```js
applyEventWording(currentGroup?.industry === 'event');
```

| # | 関数 | 挿入位置 |
|---|---|---|
| 1 | `restoreSession()` | L1511 `currentGroup = member.group_sessions;` の直後（`syncProfileForm();` の直前） |
| 2 | `restoreExistingMembershipIfAny()` | L1601 `currentGroup = m.group_sessions;` の直後 |
| 3 | `createGroup()` | `currentGroup` へ代入している箇所（L1710前後）の直後 |
| 4 | `joinGroup()` | `currentGroup` へ代入している箇所（L1800前後）の直後 |
| 5 | `switchGroup()` | L4292 `currentGroup = newGroup;` の直後 |

---

## 6. 【E1/E4】`createGroup()` の変更

`index.html` L1677〜1691 を変更する。

### 変更前

```js
    const groupId = generateGroupId();
    const expiresAt = new Date(); expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const regionVal = document.getElementById('input-region').value;

    const { data: result, error: rpcError } = await supabase.rpc(
      'create_group_with_creator',
      {
        p_display_name: displayName,
        p_industry: industryVal,
        p_group_id: groupId,
        p_group_name: groupNameVal || null,
        p_region: regionVal || null,
        p_expires_at: expiresAt.toISOString(),
        p_max_members: 50
      }
    );
```

### 変更後

```js
    const groupId = generateGroupId();
    // [Issue⑬ E1/E4] event のみ期限・上限を差し替える（第4章・第8章）
    const isEventGroup = (industryVal === 'event');
    let expiresAt;
    if (isEventGroup) {
      const lastDay = document.getElementById('input-event-last-day')?.value || '';
      if (!lastDay) { showToast(t('toast_event_last_day_required')); return; }
      const base = new Date(`${lastDay}T00:00:00`);          // ローカル時刻として解釈
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (base < today) { showToast(t('toast_event_last_day_past')); return; }
      expiresAt = new Date(base); expiresAt.setDate(expiresAt.getDate() + 1);  // 翌日00:00
    } else {
      expiresAt = new Date(); expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    }
    const regionVal = document.getElementById('input-region').value;

    const { data: result, error: rpcError } = await supabase.rpc(
      'create_group_with_creator',
      {
        p_display_name: displayName,
        p_industry: industryVal,
        p_group_id: groupId,
        p_group_name: groupNameVal || null,
        p_region: regionVal || null,
        p_expires_at: expiresAt.toISOString(),
        p_max_members: isEventGroup ? 202 : 50
      }
    );
```

**★ `showToast(...); return;` は `showToast('グループを作成中...')` より後に置くこと。** 上記の位置（`try` ブロック内・`showToast('グループを作成中...')` の直後の行から）を守れば問題ない。

---

## 6-2. 【E4】`currentGroup` キャッシュの上限も差し替える ★v1.2で追加

`index.html` L1715 付近。RPC 成功後に `currentGroup` を組み立てている箇所。

**6章（L1690）だけを直すと、DBには 202 が入るのに画面のキャッシュは 50 のままとなり、
プロフィール画面の参加人数表示が「N / 50人」と誤表示される。必ず両方を直すこと。**

### 変更前

```js
    currentGroup = {
      id: result.group_session_id,
      group_id: result.group_id,
      group_name: result.group_name,
      industry: result.industry,
      region: result.region,
      expires_at: expiresAt.toISOString(),
      max_members: 50
    };
```

### 変更後

```js
    currentGroup = {
      id: result.group_session_id,
      group_id: result.group_id,
      group_name: result.group_name,
      industry: result.industry,
      region: result.region,
      expires_at: expiresAt.toISOString(),
      max_members: isEventGroup ? 202 : 50   // [Issue⑬ E4] 6章 p_max_members と必ず同じ値にする
    };
```

**`isEventGroup` は 6章で宣言済みの変数をそのまま使う。再宣言しないこと。**
**`expires_at` の行は変更しない**（6章で `expiresAt` の中身が既に event 用へ差し替わっているため）。

---

## 7. 【E4】GROUP_FULL の固定文言を修正

`index.html` L1777〜1778 を変更する。**「最大50名」がハードコードされており、event（202）では誤表示になる。**

```js
// 変更前
      } else if (msg.includes('GROUP_FULL')) {
        showToast('このグループは満員です（最大50名）');
// 変更後
      } else if (msg.includes('GROUP_FULL')) {
        showToast(t('toast_group_full'));
```

---

## 8. 【E10】期限切れイベントの復帰・一覧除外

### 8-1. `restoreSession()` の期限切れ分岐（L1513〜1524）

`const notice = ...` の行のみを変更する。**それ以外（`clearEdgeOpsLocalStorage()`・`hideLoading()`・`showScreen('screen-start')`・`return`）は一切変更しない。**

```js
// 変更前
          const notice = document.getElementById('start-expiry-notice');
// 変更後
          const isEventExpired = (currentGroup?.industry === 'event');
          const notice = document.getElementById(isEventExpired ? 'start-expiry-notice-event' : 'start-expiry-notice');
```

### 8-2. `restoreExistingMembershipIfAny()`（L1579〜1596）★重要

**この関数には期限チェックが存在せず、期限切れイベントへ復帰してしまう。**
**期限切れの通常グループは現行どおり復帰させること**（挙動を変えないため）。**除外するのは期限切れ event のみ。**

```js
// 変更前
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.warn('restoreExistingMembershipIfAny query error:', error);
      return false;
    }
    if (!data || data.length === 0) return false;
    const m = data[0];
    if (!m.group_sessions) return false;
```

```js
// 変更後
      .order('created_at', { ascending: false })
      .limit(20);                       // [Issue⑬ E10] 期限切れeventを飛ばすため全所属を取得
    if (error) {
      console.warn('restoreExistingMembershipIfAny query error:', error);
      return false;
    }
    if (!data || data.length === 0) return false;
    // [Issue⑬ E10] 期限切れ event のみスキップ。通常グループは期限切れでも現行どおり復帰する
    const m = data.find(r => {
      const g = r.group_sessions;
      if (!g) return false;
      if (g.industry !== 'event') return true;
      return !(g.expires_at && new Date(g.expires_at) <= new Date());
    });
    if (!m) return false;
    if (!m.group_sessions) return false;
```

**`.limit(20)` は所属上限（20グループ）と一致しており、取得漏れは発生しない。**

### 8-3. `loadMyGroups()`（L4225〜4258）

```js
// 変更前（L4236-4239）
  const { data: groups } = await supabase
    .from('group_sessions')
    .select('id, group_id, group_name')
    .in('id', groupIds);
// 変更後
  const { data: groups } = await supabase
    .from('group_sessions')
    .select('id, group_id, group_name, expires_at, industry')   // [Issue⑬ E10]
    .in('id', groupIds);
```

`const merged = memberships.map(...)` のブロックの**直後**、`merged.sort(...)` の**直前**に、除外処理を追加する。

```js
  // [Issue⑬ E10] 期限切れ event のみ一覧から除外（第14章）。通常グループは現行どおり表示する
  const visible = merged.filter(x => {
    const g = (groups || []).find(y => y.id === x.group_session_id);
    if (!g || g.industry !== 'event') return true;
    return !(g.expires_at && new Date(g.expires_at) <= new Date());
  });
```

`merged.sort(...)` と `return merged;` を、`visible.sort(...)` と `return visible;` に変更する。

### 8-4. `switchGroup()` / `joinGroup()` は変更しない

- `switchGroup()`：8-3 で一覧から消えるため到達しない。**コードは変更しないこと。**
- `joinGroup()`：`join_group_with_member` RPC が既に `expires_at > NOW()` を判定し `GROUP_NOT_FOUND_OR_EXPIRED` を返す。**変更不要。**

いずれも実機確認の対象には含める（第10章）。

---

## 9. 変更禁止領域

```
【不可侵・変更禁止】
- group_sessions / group_members / messages（L3保護領域）の列・制約・RLS Policy・既存データ
- 既存RPC本体（create_group_with_creator / join_group_with_member）／新規RPCの作成
- 保護4関数の構造（restoreSession / joinGroup / generateSignageToken / ensureCurrentUser）
  ※ 本指示書 8-1・8-2 で指定した行のみ変更可。それ以外は1行も触らない
- 既読集計ロジック・realReadMap・read_receipts・receiver_count・item_receivers
- syncProfileForm() の構造・profileFormGroupId ガード
- t() / applyLang() / setLang() / normalizeLang() / getCurrentLang() の実装
- js/i18n.js の既存164キーの値
- signage.html / signage-fetch / upload-image / admin.html
- 承認処理（approveMember）・画像投稿権限・既読表示（PR2以降で扱う）
- messages.priority の値・CSSクラス名・並び順
- DBアクセスを js/ 配下5ファイルに新設しないこと
- 新規JSファイルを作成しないこと
```

---

## 10. 実機確認（マージ後・野口が実施）

### 通常グループ（回帰・最優先）

> **★確認に使うグループ**：**「フロント」**（7/25に「フロント2」から改名）または「江の島フットボールクラブ」。
> **「社員⭐︎」（SL-HX4H9-MHTW）はスマイルホテル様の本番グループである。**
> **投稿・退出・設定変更を含む実機確認を、このグループで行ってはならない。**
> マージ後に「一覧が開ける・投稿が表示される」ことを目視するまでにとどめる。

| # | 確認項目 |
|---|---|
| 1 | 「フロント」で、ホーム・連絡一覧・詳細・プロフィールの表示が7/24と一切変わっていない |
| 2 | 新規に「ホテル・旅館」でグループを作成でき、有効期限が1年後になっている |
| 3 | 業種プルダウンで「ホテル・旅館」を選んでも期限入力欄が出ない |
| 4 | 「新しいグループを作る」「グループIDを入力して参加」の文言が従来どおり |
| 5 | JA/EN を切り替えても4の文言が従来どおり |
| 6 | グループ切替リストに既存グループがすべて表示される |
| 6-2 | **プロフィール画面の参加中人数が「N / 50人」のまま**（★6-2章の回帰） |

### イベントグループ

| # | 確認項目 |
|---|---|
| 7 | 業種で「イベント・催事」を選ぶと期限入力欄が現れ、文言が「新しいイベントを作る」「イベントコードを入力して参加」に変わる |
| 8 | 期限未入力で作成しようとすると「利用できる最終日を選択してください」が出る |
| 9 | 昨日以前の日付では「本日以降の日付を選択してください」が出る |
| 10 | 作成後、プロフィールの有効期限が「選択日の翌日」になっている |
| 11 | プロフィールのGID枠が「あなたのイベントコード」になっている |
| 11-2 | **プロフィール画面の参加中人数の分母が「202人」になっている**（★6-2章の確認。分母200表示はPR2で対応するため、この時点では202でよい） |
| 12 | JA/EN を切り替えても11がイベント表記のまま（グループIDに戻らない） |
| 13 | イベントグループ → 通常グループへ切り替えると、文言が「あなたのグループID」に戻る |

### 期限切れイベント（Supabaseで `expires_at` を過去日にして検証）

| # | 確認項目 |
|---|---|
| 14 | グループ切替リストに期限切れイベントが表示されない |
| 15 | 期限切れイベントのコードで再参加しようとすると弾かれる |
| 16 | アプリ再起動時、期限切れイベントに復帰せず、他の所属グループへ復帰する |
| 17 | 期限切れイベントが唯一の所属の場合、作成／参加画面に戻る |
| 18 | 期限切れ**通常**グループでは、従来どおり「グループの有効期限が切れました」が表示される |

---

## 11. 反映手順（野口）

1. マージ前に `pre-event-pr1` タグを作成する
2. PR差分を確認する
   - **変更が `index.html` と `js/i18n.js` の2ファイルのみであること**
   - **`max_members` の `50` が2箇所とも書き換わっていること**（6章＝`p_max_members` ／ 6-2章＝`currentGroup`）
3. マージ・本番反映
4. 第10章の確認を実施する（**1〜6の回帰を最初に行う**）

以上。
