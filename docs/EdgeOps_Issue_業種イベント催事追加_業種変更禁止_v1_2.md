# Issue: 業種「イベント・催事」の追加とグループ作成後の業種変更禁止

## 概要

業種の選択肢に「イベント・催事」を追加し、グループ作成後は業種を変更できないようにする。
あわせて、業種の表示を**GID枠（あなたのグループID の枠内）へ移設**し、一般メンバーからも確認できるようにする。

**DBへの変更は一切行わない。CSSも変更しない。** 対象ファイルは `index.html` と `js/i18n.js` の2本のみ。

判定：チャッピー第132回（EO-DEC-0132）GO・第133回（EO-DEC-0133）GO
計画書：EdgeOps_実装計画書_業種イベント催事追加_業種変更禁止_v1_2.md

---

## 【不可侵・変更禁止】

- DBへの変更（DDL・UPDATE・INSERT）を一切行わないこと
- L3三テーブル（`group_sessions` / `group_members` / `messages`）に触れないこと
- RLS・GRANT・Policy を変更しないこと
- 既存6業種の value・表示名・並び順を変更しないこと
- `TEMPLATES` の既存6キーの中身を変更しないこと
- `updateIndustry()` の既存処理本体を変更しないこと（冒頭に `console.warn` と早期リターンを追加するのみ）
- `syncProfileForm()` の構造・呼び出し4経路を変更しないこと
- `profileFormGroupId` によるガード機構を変更しないこと
- `js/i18n.js` の既存キー（`form_change_industry` / `btn_update_industry`）を削除しないこと
- **GID枠（`.group-id-box`）の既存要素（GID・コピーボタン・有効期限・参加中・切替ボタン）を変更しないこと**
- **`styles.css` を変更しないこと**（`.group-id-box` は `text-align:center` のため追加CSSは不要）
- **id `profile-industry` を変更しないこと。また同一idが2箇所に存在する状態を作らないこと**
- ローカル関数のグローバル昇格を行わないこと
- 対象ファイルは `index.html` と `js/i18n.js` のみ。他ファイルを変更しないこと

---

## 変更1：新規作成画面の業種select（index.html L201-208）

`club` の直後に1行追加する。**既存6行は1文字も変更しない。**

```html
            <option value="club">部活・クラブ</option>
            <option value="event">イベント・催事</option>
```

---

## 変更2：TEMPLATES に event キーを追加（index.html L2456付近）

`club` ブロックの直後、`};` の直前に追加する。**既存6キーは1文字も変更しない。**

```js
  event: [
    '本日の開催時間をお知らせします。開場〇〇時、開演〇〇時、終了〇〇時です。担当者は配置時刻をご確認ください。',
    '〇〇ブースの設営が完了しました。担当スタッフは最終確認をお願いします。',
    '来場者数が〇〇名を超えました。〇〇エリアが混雑しています。誘導担当は対応をお願いします。',
    '本日のタイムテーブルに変更があります。〇〇時からの〇〇は〇〇時へ変更となりました。関係者へ共有をお願いします。',
    '落とし物・忘れ物の情報を共有します。〇〇エリアで〇〇が届いています。本部までご案内ください。',
    '撤収作業を〇〇時より開始します。担当者は〇〇へお集まりください。',
  ],
```

---

## 変更3：GID枠に業種の表示行を新設（index.html L682-692）

「コピー」ボタンの直後、有効期限・参加中を含む `<div>` の**直前**に追加する。

**変更前**

```html
      <button class="copy-btn" onclick="copyGroupId()" data-i18n="btn_copy">コピー</button>
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:4px;">
        <div style="font-size:12px; color:rgba(255,255,255,0.7);" id="profile-expires">有効期限：取得中...</div>
```

**変更後**

```html
      <button class="copy-btn" onclick="copyGroupId()" data-i18n="btn_copy">コピー</button>
      <div style="margin-top:10px; font-size:12px; color:rgba(255,255,255,0.7);">
        <span data-i18n="label_industry_prefix">業種：</span><span style="color:rgba(255,255,255,0.95); font-weight:600;" id="profile-industry">---</span>
      </div>
      <div style="margin-top:10px; display:flex; flex-direction:column; gap:4px;">
        <div style="font-size:12px; color:rgba(255,255,255,0.7);" id="profile-expires">有効期限：取得中...</div>
```

**CSSの追加は不要。** `.group-id-box` が `text-align: center` のため自動的に中央揃えになる。

---

## 変更4：管理者メニューの業種UIを削除（index.html L700-712）

次の**13行を削除する**。

```html
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label" data-i18n="form_change_industry">業種を変更</label>
          <select class="form-input" id="profile-industry">
            <option value="">-- 選択してください --</option>
            <option value="hotel">ホテル・旅館</option>
            <option value="clinic">病院・クリニック</option>
            <option value="care">介護施設</option>
            <option value="attraction">集客施設</option>
            <option value="freelance">フリーランス集団</option>
            <option value="club">部活・クラブ</option>
          </select>
        </div>
        <button class="btn btn-secondary" onclick="updateIndustry()" style="margin-bottom:12px;" data-i18n="btn_update_industry">業種を更新</button>
```

**変更3と変更4は必ず同一PRで行うこと。** 片方だけだと id `profile-industry` が重複または消失する。

---

## 変更5：getIndustryLabel() の新設（index.html）

`updateIndustry()` の直前に新設する。

```js
// ── 業種の表示名を返す（value → 表示名） ──
// [2026/7/21] プロフィール画面（GID枠）の業種表示用に新設
//   第132回指摘「表示文言と内部値を混ぜず統一」に従い、対応をこの1箇所に集約する
function getIndustryLabel(value) {
  const labels = {
    hotel: 'ホテル・旅館',
    clinic: '病院・クリニック',
    care: '介護施設',
    attraction: '集客施設',
    freelance: 'フリーランス集団',
    club: '部活・クラブ',
    event: 'イベント・催事'
  };
  return labels[value] || value || '';
}
```

**`|| value || ''` のフォールバックを必ず含めること。**

---

## 変更6：updateIndustry() の無効化（index.html L3243付近）

**関数を削除しない。** 冒頭に2行追加するのみ。**既存の処理本体は1行も変更しない。**

```js
// ── 業種変更（管理者のみ） ──
// [2026/7/21] 業種はグループ作成時に確定し、後から変更不可とした（開発順序 第2項・第132回GO）
//   UI側の変更導線も削除済み。本関数は呼び出し元が存在しないが、
//   累積温存原則により関数本体は残置する。将来、施設管理者による変更を
//   Plus版 manager.html で実装する場合はそちらで新規実装すること。
async function updateIndustry() {
  console.warn('updateIndustry(): disabled - 業種はグループ作成時に確定し変更不可（2026/7/21）');
  showToast('業種はグループ作成時に決まり、後から変更できません');
  return;
  // ↓ 以下、旧処理（呼び出されない・変更禁止）
  if (!isCreator) { showToast('管理者のみ変更できます'); return; }
  // ... 以下、既存コードをそのまま残す ...
}
```

---

## 変更7：syncProfileForm() の業種セット（index.html L3410-3411）

**【最重要】`.value` ではなく `.textContent` を使うこと。** 要素が `<select>` から `<span>` へ変わるため。

**変更前**

```js
  const indEl = document.getElementById('profile-industry');
  if (indEl) indEl.value = currentGroup?.industry || '';
```

**変更後**

```js
  const indEl = document.getElementById('profile-industry');
  if (indEl) indEl.textContent = getIndustryLabel(currentGroup?.industry);
```

**`.value` のままにすると、エラーは出ないが画面に何も表示されない**（業種欄が「---」のまま）。

他の2項目（`profile-group-name` / `profile-link-url`）には触れないこと。

---

## 変更8：翻訳キーの追加（js/i18n.js）

**ja ブロック：L79（`btn_update_industry`）の直後に追加**

```js
    label_industry_prefix:      '業種：',
```

**en ブロック：L256（`btn_update_industry`）の直後に追加**

```js
    label_industry_prefix:      'Industry: ',
```

英語はコロンの後に**半角スペース**を入れる。日本語は全角コロンでスペースなし。

**既存キー `form_change_industry` / `btn_update_industry` は ja / en とも削除しないこと。**

---

## 完了条件

- [ ] 業種selectに「イベント・催事」が7番目に追加されている
- [ ] `TEMPLATES` に `event` キー（6件）が追加されている
- [ ] GID枠に「業種：〇〇」の行が追加されている（コピーボタンと有効期限の間）
- [ ] 管理者メニューの業種select＋更新ボタン（13行）が削除されている
- [ ] id `profile-industry` が GID枠内の `<span>` に1箇所だけ存在する
- [ ] `getIndustryLabel()` が新設されている（フォールバック `|| value || ''` を含む）
- [ ] `updateIndustry()` の冒頭に console.warn と早期リターンが追加されている（本体は不変）
- [ ] `syncProfileForm()` が **`.textContent`** で業種をセットしている
- [ ] `js/i18n.js` に ja / en 各1キー（`label_industry_prefix`）が追加されている
- [ ] 既存6業種の value・表示名・並び順が変更されていない
- [ ] `styles.css` が変更されていない
- [ ] DBへの変更が一切含まれていない
- [ ] 変更ファイルが `index.html` と `js/i18n.js` の2本のみである
