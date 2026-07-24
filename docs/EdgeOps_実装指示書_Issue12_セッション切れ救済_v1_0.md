# EdgeOps 実装指示書：Issue⑫ セッション切れ画面の救済経路

**作成日：2026/7/25**
**根拠判定：チャッピー第155回（EO-DEC-0155・条件付きGO）**
**採用案：ア-1 ＋ イ-1 ＋ ウ-1**

---

## 0. この作業の目的

LINEを閉じて即座に開き直すと「セッションが切れました」画面が出る事象への対策。
**認証失敗時の救済経路を追加する。正常起動の処理には一切触れない。**

---

## 1. 変更対象ファイル（この2つだけ）

| # | ファイル | 変更箇所 |
|---|---|---|
| 1 | `auth.js`（ルート直下・867行） | `resolveEoUidViaLineAuth()` 内の2箇所 |
| 2 | `index.html`（4,378行） | `showReauthScreen()` 内の1箇所 |

**上記2ファイル以外は1文字も変更しないこと。**

---

## 2. 【最優先制約】通常グループを壊さない

実顧客（スマイルホテル様）が本番稼働中。
**認証が正常に通るユーザーの体験を1ミリも変えてはならない。**

- リトライは **id_token が取得できた時点で即 break** する（成功時の待ち時間はゼロ）
- `liff.login()` は **HTTP 400/401 のときだけ**呼ぶ（他のステータスでは呼ばない）

---

## 3. 変更禁止領域（不可侵）

```
【不可侵・変更禁止】
- eo_uid 生成式・salt（'edgeops_v1_2026'）
- generateEoUid() / resolveEoUidLegacy() / LINEAdapter / currentAdapter
- line-auth Edge Function 本体（サーバ側は一切触らない）
- setSession / sessionStorage 保存 / localStorage キャッシュ更新 / users upsert
- LS_KEYS / SS_KEYS の定義
- refreshEdgeOpsAccessToken() / ensureFreshToken() / callImageFunction()
- decodeJwtPayload() / startTokenRefreshTimer() / _periodicTokenCheck()
- 保護4関数（restoreSession / joinGroup / generateSignageToken / ensureCurrentUser）
- showLiffOutsideErrorScreen()（第64回）・isInClientWithRetry()（第76回）
  ・assertLiffEnvironment()（第72回）
- index.html L1350-1364 の呼び出し側ブロック（第126回実装・後述の理由により変更不要）
- signage.html / signage-fetch（別認証経路・今回は完全に対象外）
- group_sessions / group_members / messages（L3保護領域）
- 既読集計ロジック・realReadMap・item_receivers・read_receipts
- DB / RPC / RLS Policy / GRANT（今回はDB変更を一切含まない）
- 新規JSファイルを作成しないこと
- ローカル関数のグローバル昇格を行わないこと
```

---

## 4. 変更① `auth.js` — getIDToken() にリトライを入れる

### 対象：`auth.js` L152-163（`resolveEoUidViaLineAuth` の冒頭）

### 変更前（現行コード・そのまま存在する）

```js
async function resolveEoUidViaLineAuth(supabaseClient) {
  // (a) LIFF id_token 取得
  let id_token;
  try {
    id_token = liff.getIDToken();
    if (!id_token) {
      throw new Error('liff.getIDToken() returned empty');
    }
  } catch (e) {
    console.error('[auth.js] LIFF id_token 取得失敗:', e);
    throw new Error('LIFF id_token unavailable: ' + (e?.message || e));
  }
```

### 変更後

```js
async function resolveEoUidViaLineAuth(supabaseClient) {
  // (a) LIFF id_token 取得
  // ═══════════════════════════════════════════
  // [2026/7/25 第155回判定 EO-DEC-0155 案ア-1] getIDToken の500msリトライ
  // ═══════════════════════════════════════════
  // 背景:LINEを閉じて即座に開き直すと、SDK初期化直後に getIDToken() が
  //   一瞬 空/null を返すことがあり、そのまま throw して
  //   showReauthScreen()（セッション切れ画面）に落ちていた。
  //   同種の問題は liff.isInClient() で2回発生しており（第72回・第76回）、
  //   いずれも500msリトライで解決している。同じパターンを適用する。
  // 設計:最大3回試行（初回 → 500ms後 → さらに500ms後）。
  //   ★取得できた時点で即 break するため、正常時の待ち時間はゼロ。
  let id_token = null;
  for (let i = 0; i < 3; i++) {
    try {
      id_token = liff.getIDToken();
    } catch (e) {
      console.warn('[auth.js] getIDToken attempt ' + (i + 1) + ' threw:', e?.message);
      id_token = null;
    }
    if (id_token) {
      if (i > 0) console.log('[auth.js] getIDToken succeeded on attempt ' + (i + 1));
      break;
    }
    if (i < 2) await new Promise(r => setTimeout(r, 500));
  }
  if (!id_token) {
    console.error('[auth.js] LIFF id_token 取得失敗（3回試行）');
    throw new Error('LIFF id_token unavailable after 3 attempts');
  }
```

**注意：`let id_token;` を `let id_token = null;` に変えている。** 後段の `body: JSON.stringify({ id_token })` はそのまま動作する（変更不要）。

---

## 5. 変更② `auth.js` — line-auth 400/401 の救済

### 対象：`auth.js` の `(d) line-auth Edge Function 呼び出し` 内、`if (!res.ok) {` ブロック

### 変更前（現行コード）

```js
    if (!res.ok) {
      const errBody = await res.text();
      console.error('[auth.js] line-auth エラー:', res.status, errBody);
      throw new Error('line-auth failed: HTTP ' + res.status + ' ' + errBody);
    }
```

### 変更後

```js
    if (!res.ok) {
      const errBody = await res.text();
      console.error('[auth.js] line-auth エラー:', res.status, errBody);

      // ═══════════════════════════════════════════
      // [2026/7/25 第155回判定 EO-DEC-0155 案イ-1] 400/401 時の再ログイン救済
      // ═══════════════════════════════════════════
      // 背景:閉じて即開いた際、失効した id_token が使い回されて line-auth が
      //   400 を返すことがある。従来はそのまま throw → セッション切れ画面。
      // 設計:400/401 のときだけ、5分クールダウン付きで liff.login() を1回試す。
      //   ・liff.logout() は呼ばない（第63回条件）
      //   ・クールダウンは refreshEdgeOpsAccessToken() の Phase 5 と同型
      //   ・★第155回追加条件:login() が画面遷移しなかった場合に備え、
      //     ここで return せず throw する。呼び出し側（index.html L1359）の
      //     !_auth ガードに落ちる想定ではなく、確実に catch 側へ落とす。
      if (res.status === 400 || res.status === 401) {
        try {
          const LAST_REAUTH_KEY = 'edgeops_last_reauth_login_ms';
          const lastLogin = parseInt(localStorage.getItem(LAST_REAUTH_KEY) || '0', 10);
          const elapsed = Date.now() - lastLogin;
          const canLogin = typeof liff !== 'undefined'
                        && liff.isInClient && liff.isInClient()
                        && liff.login;
          if (elapsed >= 5 * 60 * 1000 && canLogin) {
            console.warn('[auth.js] 第155回:line-auth ' + res.status
              + ' → liff.login() を1回試行');
            localStorage.setItem(LAST_REAUTH_KEY, String(Date.now()));
            liff.login();   // logout は呼ばない（第63回条件）
            // liff.login() は通常ここでページ遷移する。
            // 万一遷移しなかった場合は下の throw に進み、
            // showReauthScreen() へ落ちる（undefined のまま後続へ進ませない）。
          } else {
            console.warn('[auth.js] 第155回:再ログイン見送り（cooldown '
              + Math.floor(elapsed / 1000) + 's / canLogin=' + canLogin + '）');
          }
        } catch (e) {
          console.warn('[auth.js] 第155回:再ログイン試行で例外（継続）:', e?.message);
        }
      }

      throw new Error('line-auth failed: HTTP ' + res.status + ' ' + errBody);
    }
```

### 【第155回 追加条件への対応・重要】

チャッピーの条件は「**`liff.login()` が画面遷移しなかった場合に `undefined` のまま後続へ進ませない**」。

**本指示書では `return` を使わず、必ず `throw` に到達させることで対応している。**

理由：`return`（undefined 返却）にすると `resolveEoUid` が undefined を返し、
呼び出し側の `if (!_auth || !_auth.eoUid)` ガード（index.html L1359・第126回実装）で受ける形になる。
これでも動作はするが、**`throw` の方が経路が1本にまとまり、ログも残るため安全**。

**結果として index.html の呼び出し側（L1350-1364）は変更不要。**

---

## 6. 変更③ `index.html` — 「もう一度試す」ボタン

### 対象：`index.html` L1068-1080 の `showReauthScreen()`

### 変更前（現行コード）

```js
    function showReauthScreen() {
      const existing = document.getElementById('reauth-error');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.id = 'reauth-error';
      div.style.cssText = 'position:fixed; inset:0; z-index:99999; background:#0f2f3f; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center; font-family:sans-serif;';
      div.innerHTML =
        '<div style="font-size:20px; font-weight:bold; margin-bottom:16px;">セッションが切れました</div>' +
        '<div style="font-size:14px; line-height:1.7; max-width:480px; color:#dbe7ec;">お手数ですが、LINEをいったん閉じて、リッチメニューから EdgeOps を起動し直してください。<br><br>再起動すると元の画面に戻ります。</div>';
      document.body.appendChild(div);
      document.body.style.overflow = 'hidden';
    }
```

### 変更後

```js
    function showReauthScreen() {
      const existing = document.getElementById('reauth-error');
      if (existing) existing.remove();
      const div = document.createElement('div');
      div.id = 'reauth-error';
      div.style.cssText = 'position:fixed; inset:0; z-index:99999; background:#0f2f3f; color:#fff; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center; font-family:sans-serif;';
      div.innerHTML =
        '<div style="font-size:20px; font-weight:bold; margin-bottom:16px;">セッションが切れました</div>' +
        '<div style="font-size:14px; line-height:1.7; max-width:480px; color:#dbe7ec;">下の「もう一度試す」を押してください。<br>それでも直らない場合は、LINEをいったん閉じて、リッチメニューから EdgeOps を起動し直してください。</div>' +
        // ═══════════════════════════════════════════
        // [2026/7/25 第155回判定 EO-DEC-0155 案ウ-1] 「もう一度試す」ボタン
        // ═══════════════════════════════════════════
        // 第128回で廃止したのは liff.login() を呼ぶ「再認証して続ける」ボタン。
        // これは location.reload() であり別物。第128回と矛盾しない。
        // 現場端末（サイネージ／ドデカスマホ）では、文字だけの再起動案内は
        // 運用負荷が高いため、その場で復帰できる導線を置く。
        '<button id="reauth-retry-btn" style="margin-top:28px; padding:14px 32px; font-size:16px; font-weight:bold; color:#fff; background:#0F6B63; border:none; border-radius:9px; font-family:inherit; cursor:pointer;">もう一度試す</button>';
      document.body.appendChild(div);
      document.body.style.overflow = 'hidden';
      const retryBtn = document.getElementById('reauth-retry-btn');
      if (retryBtn) {
        retryBtn.addEventListener('click', function () {
          retryBtn.disabled = true;
          retryBtn.textContent = '読み込み中…';
          retryBtn.style.opacity = '0.6';
          location.reload();
        });
      }
    }
```

### デザイン準拠（UIデザイン仕様書 v1.13）

| 項目 | 値 | 根拠 |
|---|---|---|
| ボタン背景 | `#0F6B63`（ディープティール） | アクセント色 |
| 角丸 | `9px` | 全要素統一 |
| フォント | `font-family:inherit` | 親の sans-serif を継承 |
| 文字サイズ | `16px` | 最小本文規定を満たす |

**絵文字は使用しない。** インラインSVGも不要（テキストボタンのみ）。

---

## 7. 実装後の確認事項（野口さんが実機で行う）

| # | 確認内容 | 期待結果 |
|---|---|---|
| 1 | 通常起動（LINE→リッチメニュー→EdgeOps） | **これまでどおり。待ち時間が増えていない** |
| 2 | フロント2グループの連絡一覧表示 | 変化なし |
| 3 | 江の島フットボールクラブの表示 | 変化なし |
| 4 | EdgeOpsを閉じて即座に開き直す（5回程度） | セッション切れ画面が**出にくくなっている** |
| 5 | セッション切れ画面が出た場合 | **「もう一度試す」ボタンが表示される** |
| 6 | 「もう一度試す」を押す | 画面がリロードされ、多くの場合そのまま復帰する |
| 7 | サイネージ端末の表示 | **一切変化がないこと**（signage.html は未変更） |
| 8 | 画像投稿 | 変化なし（`callImageFunction` は未変更） |

---

## 8. 反映手順（野口さん）

1. **`pre-reauth-retry` タグを打つ**（第155回の必須条件・切り戻し用）
2. Copilot の PR を差分確認（**変更が `auth.js` と `index.html` の2ファイルのみであること**）
3. マージ・本番反映
4. 上記 第7章の確認を実施

---

## 9. 変更行数の目安

| ファイル | 追加 | 削除 | 実質 |
|---|---|---|---|
| `auth.js` | 約50行 | 約12行 | 約38行増 |
| `index.html` | 約15行 | 約3行 | 約12行増 |

**DB変更・RPC変更・権限変更は一切含まない。** 切り戻しはタグから即可能。

以上。
