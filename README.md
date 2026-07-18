# 会議作業管理

`SPEC.md` に基づく、個人用の Google Apps Script Web アプリです。会議文字起こしの解析、理解度クイズ、必要な作業候補だけのガイド化、Googleドキュメント/JSON保存、中断・再開可能な実行までを一つの画面で扱います。

## 自動セットアップ・デプロイ

UIを Playwright で操作する方式ではなく、Google 公式の `clasp` を使います。Apps Script の画面変更に影響されにくく、ログイン情報や既存ブラウザ Cookie をスクリプトへ渡す必要がありません。

前提は Node.js 20 以上と、Google アカウント側の [Apps Script API 有効化](https://script.google.com/home/usersettings) です。CLI の詳細は [Google 公式 clasp ガイド](https://developers.google.com/apps-script/guides/clasp) を参照してください。

```bash
npm install
npm run setup
```

初回は次の処理が順番に行われます。

1. 未ログインなら `clasp login` を起動する（Google の画面で本人がログイン）。
2. Apps Script API が無効なら設定ページを開き、ユーザーの有効化を待つ。
3. 本人所有の Web アプリ用 Apps Script プロジェクトを作成する。
4. リポジトリの `.gs` / `.html` / `appsscript.json` を push する。
5. 本人限定 Web アプリとして versioned deployment を作成する。
6. `?setup=1` 付きURLをブラウザで開く。初回の権限同意後、Driveフォルダと管理スプレッドシートを自動作成する。

ブラウザを開けない環境ではURLが端末に表示されます。手動で開いてログイン・同意してください。

既存 Apps Script プロジェクトを使う場合:

```bash
npm run setup -- --script-id YOUR_SCRIPT_ID
```

二回目以降の更新デプロイ:

```bash
npm run deploy
```

CI やヘッドレス環境では `--no-open` を指定できます。`.clasp.json` と `.deploy-state.json` はローカル環境情報として Git 管理から除外されます。`~/.clasprc.json` は OAuth 更新トークンを含むため、共有・commitしないでください。

## 手動セットアップ（代替）

自動スクリプトを使えない場合は [SETUP_GUIDE.md](SETUP_GUIDE.md) に従ってください。Webアプリが開けていれば、未設定時のダッシュボードにある「初期設定を実行」でも同じ処理を行えます。

## セキュリティ

- `appsscript.json` の Web アプリ設定は `MYSELF` / `USER_DEPLOYING` です。
- Drive 操作はブラウザから直接行わず、すべて `google.script.run` 経由です。
- 作業ガイドの `script` 手順は、コード実装済みかつ `AllowedActionRegistry` へ本人が登録したIDだけを実行します。
- AI回答は任意コードとして実行せず、JSONとしてスキーマ検証します。
