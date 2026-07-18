# 要件定義書: 会議ログ理解・作業ガイド作成/実行システム

- 版: 1.0(確定版)
- 作成日: 2026-07-18
- 利用者: 本人のみ

---

# 1. 背景と目的

## 1.1 背景(Why)

会議で作業が発生しても「どう作業すればいいか」の段階で詰まり、タスクが実行されないまま残る問題が起きている。タスクとして発生してから、実際に実行完了するまでの時間を短くしたい。

## 1.2 目的(達成状態)

1. 保存済みの作業ガイドに従うだけで、作業を最後まで完了できる。
2. 会議の目的・コンテキストを、作業中の判断に使えるレベルで理解できている。

## 1.3 成功基準

| # | 基準 | 測定方法 |
|---|---|---|
| 1 | 作業ガイドのみで(他資料を探しに行かずに)作業が完了する | 作業ガイド実行時に、ガイド外の資料参照が発生したかを記録 |
| 2 | 会議直後の理解度確認クイズに基本全問正解できる | クイズの採点結果 |
| 3 | 会議終了から「実行可能」な作業ガイドの保存まで15分以内 | 会議登録時刻とガイド保存時刻の差分 |

## 1.4 委譲の到達点

- AIに委譲するのは「会議の解析」と「作業ガイドの作成」。
- 実行のAIへの直接委譲は現状行わない。代わりに、**繰り返し発生する作業を自動化スクリプト(登録済みGAS処理)として作成・蓄積していくことを最終目的**とする。
- 到達イメージ: 作業ガイドの手順の多くが「登録スクリプト実行」で完結し、人の作業は入力・確認・判断に限定される状態。

## 1.5 非目的

- 複数ユーザー対応、ユーザー間の権限管理、承認フロー
- 自動テストコード(単体・結合・CI)
- AIによる自由なコード実行
- クイズの「ガイド検収」への再利用(ガイド完成後にクイズを解き直す運用は行わない)
- すべての作業候補のガイド化(自分が必要と判断したものだけ作成する)

---

# 2. 用語定義

| 用語 | 定義 |
|---|---|
| 作業ガイド | 1つの作業を完了させるための手順書。Googleドキュメント(閲覧用)とJSON(実行用)の2形式で保存する |
| 作業候補 | 会議解析から抽出された、作業になりうる項目。ガイド化するかは本人が選択する |
| 登録スクリプト | AllowedActionRegistryに登録され、作業ガイドの手順から実行を許可されたGAS関数 |
| 実行セッション | 保存済み作業ガイドを開いて実行する1回分の記録。中断・再開できる |

名称は「作業ガイド」に統一する(Guide→WorkGuide、GuideVersion→WorkGuideVersion、GuideExecution→WorkGuideExecution、GuideSessions→WorkGuideBuildSessions)。

---

# 3. スコープと前提

## 3.1 利用者・公開範囲

- 利用者は本人のみ。Webアプリは本人のみアクセス可能な設定で公開する。
- ユーザーごとのロール・承認者権限・同時編集などの複数ユーザー設計は行わない。

## 3.2 技術前提

- Google Apps Script(HTML Service)内で完結させる。外部サーバー、Cloud Run、独自データベースは使用しない。
- 生成AIとの連携は、当面プロンプトのコピー&ペーストで行う。将来、安全なAI API接続が利用可能になった場合のみ、この部分を差し替える。

| 機能 | 使用技術 |
|---|---|
| 操作画面 | Apps Script HTML Service(HTML/CSS/JavaScript) |
| 画面とGASの通信 | google.script.run |
| ファイル保存 | DriveApp / DocumentApp / SpreadsheetApp |
| 詳細なDrive検索 | Advanced Drive Service |
| 一時保存 | CacheService |
| 設定値 | PropertiesService |
| 同時処理制御 | LockService |

## 3.3 既存資産

- 既存のGAS Web画面は「Google Driveの文字起こし振り分け画面」のみ。それ以外の画面・機能はすべて本システムで新規開発する。

---

# 4. 全体フロー

```text
会議終了
  ↓
文字起こしがGoogle Driveに保存される
  ↓
既存の振り分け画面からカテゴリーを選択し、カテゴリー別に保存
  ↓
会議解析用プロンプトをGASが生成(画面のコピー機能でワンタップ取得)
  ↓
生成AIへ貼り付け、回答をGASのHTML画面へ貼り付ける
  ↓
GASが内容を検証し、Drive・スプレッドシートへ保存
  ├─ 会議要約 / 決定事項 / 未決事項 / 作業候補 / 理解度確認問題
  ↓
理解度確認クイズに回答(会議直後・理解の確認)
  ↓
必要な作業候補だけを選び、作業ガイド作成を開始
  ↓
前提条件の対話的確認 → 過去資料の検索・選択 → AI投入用コンテキスト作成
  ↓
AIの作業ガイドJSONを取り込み、HTML画面上で編集・確認
  ↓
GoogleドキュメントとJSONの2形式でDriveへ保存(会議終了から15分以内が目標)
  ↓
後日、作業ガイドを開いて実行(中断・再開可)
  ↓
繰り返し作業は自動化スクリプト化し、レジストリへ登録して使い回す
```

---

# 5. 機能要件

## 5.1 会議解析(Phase 1)

- カテゴリー振り分け後の会議を登録し、文字起こしを読み取れること。
- 会議解析用プロンプトをGASが生成すること。画面上にコピー機能を設け、プロンプトをワンタップで取得できること(15分目標の達成手段)。
- AIの回答(JSON)を貼り付ける画面を持ち、貼り付け時に検証すること。
- 検証後、会議要約・決定事項・未決事項・作業候補・理解度確認問題をDrive/スプレッドシートへ保存すること。

## 5.2 理解度確認クイズ(Phase 2)

- 問題数は固定しない。会議内容(決定事項・決定理由・前提条件・未決事項・注意点・制約・自分の作業・他者の作業・判断が必要な事項の件数)に応じて、AIに必要な数を判断させる。上限は原則設けない。ただし重複問題・重要でない問題は作らない。
- 問題形式は解答負担の少ないものに限定する: 4択 / 3択 / ○× / 複数選択。自由記述は原則使用しない。複数選択は正解数を明記する。
- 正解は形式共通で `correctChoiceIndexes` の配列で持つ。
- 回答方式は「1問ずつ」「まとめて」を画面上で切り替えられること。1問ずつの場合は回答直後に解説を表示、まとめての場合は採点後に間違えた問題のみ解説を表示する。
- 回答途中の状態(未回答/回答済み/解説確認済み)を保存し、ブラウザを閉じても続きから再開できること。

## 5.3 作業候補管理(Phase 3)

- 作業候補を一覧表示できること。
- **すべての候補をガイド化する必要はない。** 本人が必要と判断した候補だけを選択して作業ガイド作成を開始する。選択しなかった候補はそのまま残す。

## 5.4 作業ガイド作成(Phase 4)

作成はHTML画面上で段階的に進める。

```text
STEP 1  作業候補を確認する
STEP 2  現在分かっている前提条件を確認する
STEP 3  不足している前提条件をAIに整理させる
STEP 4  AIが作った質問に回答する
STEP 5  Google Driveから過去資料を検索する
STEP 6  参照する資料を選択する
STEP 7  AI投入用のコンテキストを作成する(コピー機能で取得)
STEP 8  AIから作業ガイドJSONを取得し貼り付ける
STEP 9  作業ガイド内容を編集・確認する
STEP 10 Google Driveへ保存する
```

編集機能: 作業ガイド名 / 目的 / 前提条件 / 注意事項 / 手順名 / 手順説明 / URL / 入力文章 / 完了条件 / 参照資料 / 手順の順番。手順操作: 追加 / 削除 / 上下移動 / 複製 / 一時保存。

- 会議終了から実行可能なガイドの保存までを15分以内で完了できる操作性を要件とする(コピペ往復は会議解析1回+ガイド生成1回の計2回を基本とする)。

## 5.5 作業ガイド実行(Phase 5)

- 保存済みJSONをGASが読み込み、実行画面を生成すること。
- 実行前確認を行い、結果を「問題なし / 注意あり / 実行不可」の3段階で表示すること。「注意あり」は本人確認のうえ続行できる。
  - 確認対象: 参照資料の更新有無 / 対象ファイルの存在 / 対象URLの形式 / 前提条件の現在有効性 / 登録スクリプトの存在 / 必要入力値の充足
- 手順を順番に表示し、入力・確認・保存しながら進められること。
- 途中保存・中断・再開・完了ができること。実行状態はWorkGuideExecutionsシートに記録する。

## 5.6 自動化スクリプト(Phase 6)

- 権限(何をスクリプト化しAIに任せるか)は**事前に網羅的には設計しない**。作業の中でその場で判断する。
- 汎用的に使い回せそうな処理は、GAS関数として切り出し、AllowedActionRegistryへ登録する(取り出す方式)。
- 登録時に定義する項目: スクリプトID / 名称 / 説明 / パラメータ定義 / 想定される影響範囲。
- 作業ガイドの手順から実行できるのは登録済みスクリプトのみ。AIが生成した任意コードの実行は行わない。
- 実行時はパラメータを入力し、実行結果を保存する。

---

# 6. 作業ガイドのデータ要件

## 6.1 保存形式

作業ガイドは同一のIDとバージョン番号で、2形式+管理レコードとして保存する。

1. **Googleドキュメント**(閲覧用): 作業ガイド名 / 目的 / 背景 / 前提条件 / 必要な権限 / 必要な資料 / 注意事項 / 作業手順 / 各手順の完了条件 / 参照資料 / 作成日時 / バージョン
2. **JSONファイル**(実行用): 下記スキーマ
3. **管理スプレッドシート**(検索・一覧・状態管理用): 全文は持たず、ID・状態・ファイルID等のみ

## 6.2 作業ガイドJSONスキーマ

```json
{
  "schemaVersion": "1.1",
  "workGuideId": "WG-20260718-0001",
  "version": 1,
  "title": "認証ポリシー比較作業",
  "goal": "既存設定とIaC適用後の差分を確認する",
  "assumptions": ["文字列の配列"],
  "prerequisites": ["文字列の配列"],
  "warnings": ["文字列の配列"],
  "steps": [],
  "sourceSnapshots": [
    {
      "fileId": "DriveファイルID",
      "fileName": "ファイル名",
      "snapshotAt": "ISO 8601日時"
    }
  ]
}
```

## 6.3 手順(step)スキーマ

手順タイプは2種類のみ。**「表示のみ」の手順は存在しない。すべての手順は入力・URL・完了条件のいずれかを必ず伴う。**

| type | 意味 |
|---|---|
| input | 人が作業し、結果・値・チェックを入力する手順 |
| script | 登録済みスクリプトを実行する手順(許可済みスクリプトIDのみ) |

```json
{
  "stepId": "S1",
  "order": 1,
  "type": "input",
  "title": "手順名",
  "description": "手順の説明",
  "url": "https://...(基本必須。作業対象・参照先のURL)",
  "inputs": [
    {
      "inputId": "I1",
      "label": "入力項目名",
      "inputType": "text | choice | check",
      "choices": ["inputType=choiceの場合のみ"],
      "required": true
    }
  ],
  "scriptId": "type=scriptの場合のみ。AllowedActionRegistryのID",
  "scriptParams": {},
  "completionCriteria": "この手順が完了したと言える条件(必須)",
  "sourceReferences": ["参照資料のfileId"]
}
```

検証規則(§8.2)は本スキーマを正とする。

## 6.4 クイズJSONスキーマ

```json
{
  "quizTitle": "会議内容の理解確認",
  "questions": [
    {
      "questionId": "Q1",
      "type": "single_choice | multi_choice | true_false",
      "question": "問題文",
      "choices": ["選択肢の配列"],
      "correctChoiceIndexes": [1],
      "explanation": "解説",
      "topic": "decision | reason | prerequisite | pending | caution | my_task | others_task | judgement",
      "sourceReference": "会議ログ内の位置"
    }
  ]
}
```

## 6.5 Driveフォルダ構成

```text
会議作業管理/
├─ 01_文字起こし/
├─ 02_会議解析/
│   ├─ 要約/
│   └─ AI回答JSON/
├─ 03_作業ガイド/
│   ├─ 作成途中/
│   ├─ 実行可能/
│   ├─ 要確認/
│   └─ アーカイブ/
├─ 04_作業ガイド実行結果/
├─ 05_参照資料スナップショット/
└─ 99_管理/
    └─ 管理スプレッドシート
```

## 6.6 管理シート定義

**WorkGuidesシート**: workGuideId / actionId / meetingId / title / status / currentVersion / documentFileId / jsonFileId / createdAt / updatedAt / lastExecutedAt

**WorkGuideVersionsシート**: workGuideVersionId / workGuideId / versionNo / goal / assumptionsJson / prerequisitesJson / warningsJson / stepsJson / sourceSnapshotsJson / documentFileId / jsonFileId / createdAt

**WorkGuideExecutionsシート**: executionId / workGuideId / workGuideVersionId / status / currentStepId / startedAt / pausedAt / completedAt / executionDataJson / notes

**AllowedActionRegistryシート**: scriptId / name / description / paramsJson / impactNote / registeredAt

---

# 7. 保存処理の要件

作業ガイド保存ボタン押下時、1回のGAS処理で次を実行する。

```text
入力値検証 → 作業ガイドID発行 → バージョン番号発行 → JSON作成
→ Googleドキュメント作成 → JSONファイルをDriveに作成
→ 管理スプレッドシートへ登録 → 保存完了を画面へ返す
```

途中で失敗した場合は、どこまで作成されたかを返す。

```json
{
  "success": false,
  "workGuideId": "WG-20260718-0001",
  "completed": {
    "documentCreated": true,
    "jsonCreated": false,
    "spreadsheetUpdated": false
  },
  "error": "JSONファイルの作成に失敗しました"
}
```

ブラウザ側から直接Driveを操作せず、必ずGASのサーバー関数(google.script.run)を経由する。

---

# 8. 非機能要件

## 8.1 性能

- 会議終了から実行可能ガイドの保存まで: 15分以内(成功基準3)。
- 上記を支える要件: プロンプト・コンテキストのワンタップコピー、AI回答貼り付けの即時検証、コピペ往復は基本2回まで。

## 8.2 検証・誤操作防止(テストコードの代替)

自動テストコードは作成しない。代わりに実行時検証を必須とする。

- 必須値チェック / JSON.parseエラー処理 / JSON項目チェック(§6のスキーマを正とする)
- 作業ガイドIDの一致確認 / 二重保存防止 / 二重クリック防止
- 許可された手順タイプ(input / script)か確認
- 許可されたスクリプトID(AllowedActionRegistry登録済み)か確認
- URL形式確認 / Driveファイルの存在確認
- 保存前の確認画面 / 保存成功・失敗メッセージ

管理画面に診断機能(設定不備の確認)を設けてよい: 管理スプレッドシート接続 / 保存フォルダ存在 / 文字起こし読み取り / Googleドキュメント作成 / JSONファイル作成。

## 8.3 セキュリティ

- Webアプリは本人のみアクセス可の設定で公開する。
- AIには自由なコードを実行させない。実行できるのは登録済みスクリプトのみ。
- スクリプトの登録・削除は本人のみが管理画面から行う。

---

# 9. GASプロジェクト構成

```text
Main.gs / Router.gs / Config.gs

MeetingService.gs / MeetingAnalysisService.gs / QuizService.gs / ActionService.gs

WorkGuideBuildService.gs / WorkGuideService.gs / WorkGuideExecutionService.gs

DriveService.gs / SourceSearchService.gs / DocumentService.gs / SpreadsheetService.gs

AiPromptService.gs / AiResponseService.gs / JsonValidator.gs

AllowedActionRegistry.gs / IdService.gs / ErrorService.gs

Index.html / Styles.html / Client.html
DashboardView.html / MeetingView.html / QuizView.html / ActionView.html
WorkGuideBuildView.html / WorkGuideView.html / WorkGuideExecutionView.html
```

個人利用のため、Repository層や過度なクラス設計は行わない。「HTML画面 → Service関数 → DriveApp / DocumentApp / SpreadsheetApp」のシンプルな関係とする。

---

# 10. 実装フェーズとMVP

## 10.1 フェーズ

| Phase | 内容 |
|---|---|
| 1 | 会議解析(登録・文字起こし読み取り・プロンプト生成/コピー・回答貼り付け・検証・保存) |
| 2 | 理解度確認クイズ(可変問題数・3形式・途中保存・再開・解説) |
| 3 | 作業候補管理(一覧・必要な候補のみ選択・ガイド作成開始) |
| 4 | 作業ガイド作成(前提対話・資料検索/選択・コンテキスト作成・AI取り込み・編集・2形式保存) |
| 5 | 作業ガイド実行(一覧・JSON読み込み・実行前確認・手順実行・中断・再開・完了) |
| 6 | 自動化スクリプト(その場でのスクリプト化・レジストリ登録・パラメータ入力・実行・結果保存) |

## 10.2 MVP完成条件

次の流れが動けば最初の完成とする。

```text
1.  文字起こしをカテゴリー分けする
2.  会議解析プロンプトをGASで作り、コピー機能で取得する
3.  AIの回答をHTML画面へ貼り付ける
4.  会議要約と作業候補をDriveへ保存する
5.  会議内容に応じた数の選択問題を作る
6.  問題へ回答し、途中保存できる
7.  必要な作業候補を選んで作業ガイド作成を開始する
8.  前提条件へ回答する
9.  Driveから過去資料を選択する
10. 作業ガイドをAIに作らせる
11. HTML画面上で内容を修正する
12. GoogleドキュメントとJSONとしてDriveへ保存する(ここまで会議終了から15分以内)
13. 後日、作業ガイドを開く
14. 作業手順を順番に実行する
15. 途中で中断し、再度開いて続きから再開する
16. 作業を完了する
```

Phase 6(自動化スクリプト)はMVPに含めない。MVP運用の中で繰り返し作業が見えてから、取り出す方式で段階的に追加する。

---

# 11. 設計原則(要約)

```text
名称は「作業ガイド」に統一する
操作画面はGAS HTML Serviceで作り、保存は必ずGASサーバー関数経由で行う
データはGoogle DriveとGoogleスプレッドシートに保存する
可能な限りGAS内で完結させ、AI連携は当面コピー&ペースト(コピー機能で負担軽減)とする
クイズの問題数は会議内容に応じて可変とし、選択式中心で回答負担を軽くする
利用者は本人のみとし、複雑な公開範囲・権限管理は省略する
自動テストコードは作成しないが、入力検証・JSON検証・誤操作防止は必ず実装する
作業ガイドはGoogleドキュメントとJSONの両方で保存し、作成と実行を分離する
作業ガイドは後日実行でき、中断・再開できる
手順に「表示のみ」は無く、必ず入力・URL・完了条件のいずれかを伴う
AIには自由なコードを実行させず、登録済みGAS処理だけを実行させる
権限は事前に設計せず、汎用的なスクリプトをその場で取り出して蓄積する
最終目的は、繰り返し作業の自動化スクリプトが蓄積された状態に到達すること
```

---

# 12. 未決事項

| # | 項目 | 決定タイミング |
|---|---|---|
| 1 | 会議解析プロンプト・ガイド生成プロンプトの本文 | Phase 1 / Phase 4 実装時 |
| 2 | カテゴリーの一覧(既存振り分け画面の分類との対応) | Phase 1 実装時 |
| 3 | 実行前確認における「参照資料が更新されていないか」の判定方法(更新日時比較 等) | Phase 5 実装時 |
| 4 | scriptタイプ手順の実行結果の保存形式 | Phase 6 実装時 |
