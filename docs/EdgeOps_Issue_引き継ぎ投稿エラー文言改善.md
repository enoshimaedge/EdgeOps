# Issue: 引き継ぎ投稿失敗時のエラー文言を分かりやすくする

## 概要

サイネージ端末（`is_signage = true`）から引き継ぎノートを投稿しようとすると、現在は次のように表示される。

```
投稿に失敗: NOT_AUTHORIZED
```

利用者には意味が分からないため、原因が伝わる日本語に変更する。

**DBへの変更は一切行わない。** 対象ファイルは `index.html` と `js/i18n.js` の2本のみ。

関連：チャッピー第136回（EO-DEC-0136）で、サイネージ端末からの引き継ぎ投稿は「現状維持（投稿不可）」と判定済み。本Issueは動作を変えず、エラー表示のみを改善する。

---

## 【不可侵・変更禁止】

- DBへの変更（DDL・UPDATE・INSERT）を一切行わないこと
- RPC（`create_handover_with_receivers`）を変更しないこと
- L3三テーブル（`group_sessions` / `group_members` / `messages`）に触れないこと
- RLS・GRANT・Policy を変更しないこと
- **投稿の成功／失敗の判定ロジックを変更しないこと**（変えるのは失敗時の表示文言のみ）
- 既存の `console.error(e)` を削除しないこと（開発者が原因を追えるようにするため）
- `js/i18n.js` の既存キーを削除しないこと
- ローカル関数のグローバル昇格を行わないこと
- 対象ファイルは `index.html` と `js/i18n.js` のみ。他ファイルを変更しないこと

---

## 変更1：引き継ぎ投稿の catch 節（index.html L2619）

**変更前**

```js
    } catch (e) { console.error(e); showToast('投稿に失敗: ' + (e.message || JSON.stringify(e))); }
    finally { __loading.stop(); }
```

**変更後**

```js
    } catch (e) {
      console.error(e);
      const __msg = (e.message || JSON.stringify(e) || '');
      // [2026/7/21] NOT_AUTHORIZED は主にサイネージ端末からの引き継ぎ投稿で発生する（第136回・現状維持）
      //   RPC create_handover_with_receivers が is_signage=true を拒否するため。
      //   利用者に NOT_AUTHORIZED をそのまま見せず、原因が伝わる文言にする。
      if (__msg.includes('NOT_AUTHORIZED')) {
        showToast(t('toast_handover_not_authorized'));
      } else {
        showToast('投稿に失敗: ' + __msg);
      }
    }
    finally { __loading.stop(); }
```

**`console.error(e)` は必ず残すこと。** 開発者が実際の例外を追えなくなる。

---

## 変更2：翻訳キーの追加（js/i18n.js）

**ja ブロック：L127（`toast_load_failed`）の直後に追加**

```js
    toast_handover_not_authorized: 'サイネージ端末から引き継ぎノートは投稿できません',
```

**en ブロック：L304（`toast_load_failed`）の直後に追加**

```js
    toast_handover_not_authorized: 'Signage terminals cannot post handover notes',
```

既存キー（`toast_saved` / `toast_sent` / `toast_cancelled` / `toast_delete_done` / `toast_load_failed`）は削除・変更しないこと。

---

## 完了条件

- [ ] `index.html` L2619 の catch 節が、`NOT_AUTHORIZED` を含む場合とそれ以外で分岐している
- [ ] `console.error(e)` が残っている
- [ ] `NOT_AUTHORIZED` 以外のエラーでは、従来どおり「投稿に失敗: 〜」と表示される
- [ ] `js/i18n.js` に ja / en 各1キー（`toast_handover_not_authorized`）が追加されている
- [ ] RPC・DB・RLS への変更が一切含まれていない
- [ ] 通常メッセージ送信側の catch（同関数の後半）を変更していない
- [ ] 変更ファイルが `index.html` と `js/i18n.js` の2本のみである

---

## 実機確認

| # | 操作 | 期待される結果 |
|---|---|---|
| 1 | サイネージ端末から引き継ぎノートを投稿 | **「サイネージ端末から引き継ぎノートは投稿できません」**と表示される |
| 2 | 通常メンバーから引き継ぎノートを投稿 | 従来どおり成功する |
| 3 | サイネージ端末から通常メッセージを送信 | 従来どおり成功する（第136回で回復済み） |
| 4 | 言語を英語に切り替えて1を再実行 | 英語で表示される |
