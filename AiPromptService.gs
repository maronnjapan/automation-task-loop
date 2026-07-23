function buildMeetingAnalysisPrompt_(meeting, transcript) {
  return buildMeetingAnalysisJsonPrompt_(meeting, transcript, '');
}

function buildMeetingAnalysisReviewPrompt_(meeting, transcript) {
  return [
    'あなたは会議の文字起こしを、人が短時間で内容と次の作業を確認できる読みやすい案に整理します。',
    'この段階ではアプリ用JSONを作りません。JSON、コードブロック、機械向けのキー名は使わず、次の日本語見出しをそのまま使ってください。',
    '文字起こしにない事実は推測せず、不明点として明記してください。',
    '',
    '# 会議内容の確認案',
    '## 1. 要約',
    '- 会議の目的・背景・結論を、初めて読む人にも分かる文章でまとめる。',
    '## 2. 決まったこと',
    '- 理由も含めて箇条書きにする。',
    '## 3. まだ決まっていないこと・確認が必要なこと',
    '- 不明点、保留、判断待ちを箇条書きにする。',
    '## 4. 理解度クイズの方向性',
    '- 何を理解できているか確認するクイズにするのか、出題テーマと理由を列挙する。',
    '- この段階では問題文や選択肢を作り込みすぎない。',
    '## 5. 作成を検討する作業ガイド',
    '- 本人が実行・確認・委譲する具体作業だけを候補にする。他者だけの作業や単なる情報共有は含めない。',
    '- 候補ごとに、必ず次の項目を書く。',
    '  - ガイド名',
    '  - 何をするガイドか（目的と、完了したと判断できる状態）',
    '  - 必要になりそうな具体作業（実行順の番号付き。抽象語だけにしない）',
    '  - 作業前に確認すべきこと（対象、権限、期限、判断者、資料など）',
    '  - ガイド化の推奨（推奨 / 候補として残す）とその理由',
    '## 6. 人が特に確認すべき認識違いの可能性',
    '- 要約、クイズ、ガイドの方向性について、根拠が弱い箇所や複数解釈がある箇所を書く。',
    '',
    '会議情報:',
    JSON.stringify({ meetingId: meeting.meetingId, title: meeting.title, category: meeting.category, meetingEndedAt: meeting.meetingEndedAt }, null, 2),
    '',
    '文字起こし:',
    transcript
  ].join('\n');
}

function buildMeetingAnalysisJsonPrompt_(meeting, transcript, approvedReview) {
  return [
    'あなたは会議ログを、本人が直後に理解し、必要な作業だけをガイド化できる形へ構造化します。',
    '次の制約を厳守してください。',
    '- 出力は JSON オブジェクトのみを ```json コードブロックで囲んで返す。コードブロックの前後に説明文を書かない。',
    '- 文字起こしにない事実を推測しない。不明点は pendingItems に入れる。',
    '- クイズは重要事項の件数に応じた必要十分な数にし、重複・些末な問題を避ける。',
    '- single_choice は3択か4択、true_false は2択、multi_choice は正解を複数指定する。自由記述は禁止。',
    '- correctChoiceIndexes は0始まりの整数配列。',
    '- actionCandidates は本人が実行・確認・委譲する具体的な作業だけにする。他者だけの作業や単なる情報共有は含めない。',
    '- actionCandidates.description には「何をするか」「完了状態」「必要な具体作業の流れ」が人にも分かるように含める。',
    '- 各作業候補に、ガイド作成前に本人へ聞く prerequisiteQuestions を含める。',
    '- 会議ログだけで実行可能なガイドを作る価値がある具体作業は guideRecommended=true、それ以外は false にする。',
    approvedReview ? '- 下記の「人が確認・修正した内容」を合意済みの方向性として優先し、文字起こしの根拠と矛盾しない範囲でJSONへ変換する。' : '',
    '',
    '会議情報:',
    JSON.stringify({ meetingId: meeting.meetingId, title: meeting.title, category: meeting.category, meetingEndedAt: meeting.meetingEndedAt }, null, 2),
    approvedReview ? '\n人が確認・修正した内容:\n' + approvedReview : '',
    '',
    '出力スキーマ:',
    JSON.stringify({
      summary: '会議の目的・背景・結論が分かる要約',
      decisions: ['決定事項（理由を含める）'],
      pendingItems: ['未決事項'],
      actionCandidates: [{ title: '作業名', description: '完了状態を含む説明', owner: '担当者', dueDate: 'ISO日付または空文字', prerequisiteQuestions: ['不足前提を確認する選択・短文質問'], guideRecommended: true }],
      quiz: { quizTitle: '会議内容の理解確認', questions: [{ questionId: 'Q1', type: 'single_choice | multi_choice | true_false', question: '問題文', choices: ['選択肢'], correctChoiceIndexes: [0], explanation: '正解理由', topic: 'decision | reason | prerequisite | pending | caution | my_task | others_task | judgement', sourceReference: '文字起こし内の発言や位置' }] }
    }, null, 2),
    '',
    '文字起こし:',
    transcript
  ].join('\n');
}

function workGuideQualityBar_() {
  return [
    '作業ガイドの品質基準（本番環境のセットアップ手順書と同じ水準。全手順がここへ達するまで具体化する）:',
    '- 初めて作業する人が、他の資料を調べずに上から順に実行するだけで完了できる粒度まで分解する。1つの手順に複数の操作を詰め込まない。',
    '- 手順ごとに、開く画面のURLと、画面内で選ぶメニュー・ボタン・リンク・タブの名称を画面の表記どおりに書く。',
    '- 入力・設定する値は、形式・桁数・具体例まで書く（例: 「32文字の英数字のAccount ID」）。似た値と取り違えやすい場合は「〜ではない」と違いを明記する。',
    '- 完了確認は、画面に表示される文言・返ってくる値・確認のための操作など、誰が見ても判定が一致する内容にする。「〜が完了していること」のような言い換えだけの完了確認は禁止。',
    '- 失敗しやすい手順には、失敗した場合に何を確認し、どの手順からやり直すかを書く。',
    '- 必要な権限・プラン・アカウント・事前に準備する物は前提条件へ、取り返しのつかない操作・課金・データ削除・秘密情報の扱いは注意事項へ漏らさず書く。',
    '- 判断が必要な箇所は、選択肢と判断基準を書く。',
    '- 根拠資料から分からない値や手順は推測で埋めず、「作業前に確認: …」という形で前提条件に残す。'
  ].join('\n');
}

function buildWorkGuidePrompt_(context, approvedPlan) {
  return [
    'あなたは、他資料を探さずに最後まで実行できる作業ガイドを作ります。',
    '出力は JSON オブジェクトのみを ```json コードブロックで囲んで返してください。コードブロックの前後に説明文を書かないでください。',
    'workGuideId と version は入力コンテキストの値をそのまま使います。workGuideId が空文字の場合は空文字のままにし、新しいIDを発明しないでください。',
    'schemaVersion は 1.1。correctChoiceIndexes と同様、配列や型を厳密に守ってください。',
    '手順タイプは input または script のみです。表示専用手順は禁止です。',
    '各手順には具体的な description と completionCriteria が必須です。作業対象URLが分かる場合は必ず url に設定します。',
    '各手順の description には、開く画面・選ぶメニューや押すボタンの名称・入力する値（形式と例）・失敗した場合の対処までを書き、completionCriteria には客観的に判定できる完了確認を書きます。',
    'script は allowedScripts にある scriptId だけ使用できます。不適切なら input にします。',
    'sourceReferences には selectedSources の fileId だけを指定します。',
    approvedPlan ? '下記の「人が確認・修正したガイド設計案」を合意済みの方向性として優先し、目的と具体作業を忠実にJSON化してください。設計案に書かれたURL・画面名・入力値・失敗時の対処は省略せずJSONへ反映してください。' : '',
    '',
    workGuideQualityBar_(),
    '',
    '入力コンテキスト:',
    JSON.stringify(context, null, 2),
    approvedPlan ? '\n人が確認・修正したガイド設計案:\n' + approvedPlan : '',
    '',
    '出力スキーマ:',
    JSON.stringify({
      schemaVersion: '1.1', workGuideId: context.workGuideId || '', version: context.version || 1,
      title: context.action.title, goal: 'この作業の完了状態', assumptions: ['背景・既知事項'], prerequisites: ['必要な権限・入力・事前状態'], warnings: ['注意事項'],
      steps: [{ stepId: 'S1', order: 1, type: 'input', title: '手順名', description: '操作と判断の説明', url: 'https://...', inputs: [{ inputId: 'I1', label: '結果', inputType: 'text', required: true }], completionCriteria: '客観的に確認できる完了条件', sourceReferences: [] }],
      sourceSnapshots: context.selectedSources.map(function (source) { return { fileId: source.fileId, fileName: source.fileName, snapshotAt: source.snapshotAt }; })
    }, null, 2)
  ].join('\n');
}

// 台帳エントリのスキーマ（§4.1）。P1・P2 プロンプトへそのまま差し込む。
function ledgerEntryFormatText_() {
  return [
    '台帳エントリの形式（1件ごとにこの形。confidence は3状態のみ）:',
    JSON.stringify({
      entryId: 'L-012',
      stepRef: 'SK-3',
      slot: 'url | ui_label | input_value | verification | failure_recovery | precondition | caution | decision_rule | scope',
      claim: '何についての事実か（例: APIトークン作成画面のURL）',
      value: '具体値。まだ無い場合は空文字',
      evidence: { type: 'transcript | user_answer | artifact | ai_knowledge', ref: '出典（発言位置・回答番号・貼り付け資料など）', quote: '該当箇所の引用' },
      confidence: 'confirmed | assumed | unknown',
      note: '取り違え注意・補足（例: Global API Key の画面ではない）'
    }, null, 2),
    '',
    'スロットの意味:',
    '- url: 開く画面のURL。URLが存在しない作業は value を「該当なし」にして confirmed にする。',
    '- ui_label: 選ぶメニュー・ボタン・タブの画面表記どおりの名称。',
    '- input_value: 入力・設定する値の形式・桁数・具体例・取り違え注意。',
    '- verification: 完了を客観的に判定する方法（表示される文言 / 返る値 / 実行する確認操作）。',
    '- failure_recovery: 失敗時に確認する点と、どの手順からやり直すか。',
    '- precondition: そのステップに必要な権限・状態・事前準備。',
    '- caution: 不可逆操作・課金・秘密情報・データ削除の注意。',
    '- decision_rule: 判断が必要な箇所の選択肢と判断基準。',
    '- scope: このステップで変わらないこと・やらないこと。'
  ].join('\n');
}

// P1: 骨格抽出＋台帳初期化（取材ループの前に1回）
function buildGuideSkeletonPrompt_(context, options) {
  options = options || {};
  return [
    'あなたは、会議の文字起こしから「作業ガイドの骨格」と「判明している事実の台帳」を作る取材記者です。',
    options.jsonOnly
      ? 'この段階ではガイド本文を書きません。出力は {"skeleton": …, "ledger": […]} のJSONオブジェクトだけにしてください。コードブロックや説明文は禁止です。'
      : 'この段階ではガイド本文を書きません。次の2つだけを出力してください。',
    '',
    options.jsonOnly ? '' : '1. 作業の骨格（人が読む日本語）',
    options.jsonOnly ? '' : '   - 作業の目的と、完了したと客観的に言える状態',
    options.jsonOnly ? '' : '   - 実行順のステップ候補（粗くてよい。各ステップに skeletonId を SK-1 形式で振る）',
    options.jsonOnly ? '' : '   - この作業に含めない範囲',
    options.jsonOnly ? '' : '',
    options.jsonOnly
      ? '出力JSONの形式: { "skeleton": { "purpose": "…", "completion": "…", "steps": [{ "skeletonId": "SK-1", "title": "…" }], "outOfScope": ["…"] }, "ledger": [台帳エントリの配列] }'
      : '2. 骨格と事実台帳のJSON（最後に1つの ```json ブロックで出力。アプリが取り込みます）',
    options.jsonOnly ? '' : '   形式: { "skeleton": { "purpose": "…", "completion": "…", "steps": [{ "skeletonId": "SK-1", "title": "…" }], "outOfScope": ["…"] }, "ledger": [台帳エントリの配列] }',
    '   - 文字起こしに出てくる具体情報（URL、ツール名、画面や項目の呼び名、値、期限、担当、制約）を',
    '     すべてエントリ化する。evidence.quote に該当発言を引用し、confidence は confirmed とする。',
    '     ただし発言が曖昧な場合（「例の画面」「あの設定」等）は claim だけ立てて unknown とする。',
    '   - 各ステップについて、url / ui_label / input_value / verification / failure_recovery /',
    '     precondition / caution / decision_rule / scope の各スロットの現状を洗い出す。',
    '   - 文字起こしに無いが一般知識から推測できる値は、confidence: assumed で登録してよい。',
    '     推測であることを evidence.type: ai_knowledge と note に必ず書く。',
    '   - 文字起こしに無く推測もできないものは unknown で登録する。発明は禁止。',
    '   - 「事前に人へ確認する質問」の一覧がある場合は、それぞれ対応する unknown エントリを立てる。',
    '   - knownPrerequisites は本人が画面へ入力した既知情報なので evidence.type: user_answer / confidence: confirmed で登録する。',
    '   - priorWorkGuide がある場合は前版ガイドという artifact として再利用できるが、interviewSeeds で不足が報告された箇所は unknown に戻す。',
    '',
    ledgerEntryFormatText_(),
    '',
    workGuideQualityBar_(),
    '',
    '入力コンテキスト:',
    JSON.stringify(context, null, 2)
  ].join('\n');
}

// P2: 取材ラウンド（毎ラウンド同じ形で呼ぶ。この設計の中心）
function buildLedgerInterviewPrompt_(context, answersText) {
  return [
    'あなたは、作業ガイドを品質基準の水準にするための取材記者です。',
    'あなたの仕事は文章を書くことではなく、台帳の unknown と assumed を減らす',
    '「最も価値の高い質問を、相手が最も答えやすい形で」作ることです。',
    '',
    '次の6セクションを、この順番・この見出しで必ず出力してください。',
    '',
    '## 1. 回答の理解確認',
    '前回の回答をどう理解したか2〜4行で要約する（誤解があれば人がここで気づける）。初回は「初回のため無し」と書く。',
    '',
    '## 2. 台帳の更新',
    '前回の回答・貼り付け資料から追加・confirmed 化・修正するエントリだけを1つの ```json ブロック（エントリの配列）で出力。',
    '既存エントリの更新は同じ entryId を使う。追加は entryId を空文字にしてよい。無ければ空配列 [] を出力。',
    '',
    '## 3. 矛盾・気づき',
    '台帳内、文字起こしとの間、回答間の食い違い。無ければ「なし」。',
    '',
    '## 4. 仮値の監査',
    '現在 assumed のまま残っている値の一覧。それぞれ次の質問で確認するか、確認不要の理由を書く。',
    '',
    '## 5. 準備度',
    'ステップごとに、埋まったスロット/必須スロット数と、前回からの増減を1行ずつ。',
    '',
    '## 6. 次の質問（最大5問）',
    '質問設計のルール:',
    '- 想起させず確認させる。仮値がある場合は「恐らく○○だと思われます。合っていますか？」形式にする。',
    '- 説明ではなく現物を求める。「URLをそのまま貼ってください」「コマンドを実行して出力を',
    '  貼ってください」「画面の文言をコピーして貼ってください」を積極的に使う。',
    '- 選択式（はい/いいえ/3択）を優先し、自由記述は最後の手段にする。',
    '- 各質問の先頭を「Q1」のような番号にし、[対象: SK-n / スロット: xxx] と「なぜ聞くか」を1行添える。',
    '- 影響度×不確実性の高い順に並べる。',
    '- ステップの列自体が怪しい場合は、個別質問の代わりに「作業を頭の中で通しでやるつもりで、',
    '  やることを順に書き出してください。思い出せない箇所は『？』と書いてください」と依頼してよい。',
    '- 2ラウンド答えられていない質問は、質問し続けず「作業前に確認へ降格しますか？」と提案する。',
    '- 「わからない」という回答も事実として受け止め、誰なら知っているか・どの画面や資料を見れば分かるかを次に提案する。',
    '- 台帳内・文字起こし・回答間の矛盾は黙って片方を採らず、必ず次の質問で人へ裁定を求める。',
    '- 最初の1〜2ラウンドは全体の大きな穴を幅広く確認し、その後は「今回はSK-nだけを完成させます」と宣言して1ステップ集中へ切り替える。',
    '',
    ledgerEntryFormatText_(),
    '',
    workGuideQualityBar_(),
    '',
    '作業の骨格:',
    JSON.stringify(context.skeleton, null, 2),
    '',
    '現在の台帳（全文）:',
    JSON.stringify(context.ledger, null, 2),
    '',
    '前回の質問と人の回答・貼り付け資料:',
    nonEmptyString_(answersText) ? answersText : '（初回ラウンドのため無し。台帳の unknown と assumed から質問を作ってください）',
    '',
    '過去ラウンドと質問履歴（同じ質問を2回以上繰り返さないために使う）:',
    JSON.stringify({
      rounds: context.interviewRounds || [],
      previousQuestions: context.previousQuestions || [],
      questionAttempts: context.questionAttempts || {},
      executionFeedbackSeeds: context.interviewSeeds || []
    }, null, 2)
  ].join('\n');
}

// P3: ガイド生成（準備度ゲート通過後に1回）。生成は「創作」ではなく「組版」。
function buildLedgerGuidePrompt_(context, options) {
  options = options || {};
  return [
    'あなたは、確認済みの事実台帳を作業ガイドへ組版する編集者です。創作はしません。',
    '厳守事項:',
    '- 台帳で confidence: confirmed のエントリだけを事実として使う。',
    '  台帳にない URL・画面名・入力値・確認方法を新しく書くことを禁止する。',
    '- 「作業前に確認へ降格されたエントリ」は、prerequisites に',
    '  「作業前に確認: <claim>（現時点の見立て: <value>）」の形で必ず出力する。value が空なら見立て部分は省略する。',
    '- 各ステップは次の構成で書く: description の冒頭に「このステップで何が起き、何が変わらないか」/',
    '  事前チェック / 操作（URL → 画面表記どおりの選択 → 値の形式・例・取り違え注意）/',
    '  客観的な完了確認 / 失敗した場合に確認する点とやり直すステップ。',
    '- precondition は事前チェック、caution は warnings または該当手順の注意、decision_rule は操作内の判断基準、scope は scopeNote へ反映する。',
    '- stepRef がある confirmed エントリは省略せず、各ステップの evidenceRefs に使用した台帳 entryId をすべて記録する。',
    options.jsonOnly
      ? '- 出力は JSON オブジェクトのみ。コードブロックや前後の説明文を書かない。'
      : '- 出力は JSON オブジェクトのみを ```json コードブロックで囲んで返す。前後に説明文を書かない。',
    'workGuideId と version は入力コンテキストの値をそのまま使います。workGuideId が空文字の場合は空文字のままにし、新しいIDを発明しないでください。',
    'schemaVersion は ' + APP_CONFIG.schemaVersion + '。手順タイプは input または script のみで、表示専用手順は禁止です。',
    'script は allowedScripts にある scriptId だけ使用できます。不適切なら input にします。',
    'sourceReferences には selectedSources の fileId だけを指定します。',
    '',
    workGuideQualityBar_(),
    '',
    '出力スキーマ:',
    JSON.stringify({
      schemaVersion: APP_CONFIG.schemaVersion, workGuideId: context.workGuideId || '', version: context.version || 1,
      title: context.action && context.action.title, goal: 'この作業の完了状態', assumptions: ['背景・既知事項'],
      prerequisites: ['必要な権限・事前状態', '作業前に確認: 降格されたエントリ（現時点の見立て: …）'], warnings: ['注意事項'],
      steps: [{
        stepId: 'S1', order: 1, type: 'input', title: '手順名',
        description: 'このステップで何が起きるか。開く画面・押すボタン・入力する値（形式と例）・取り違え注意まで書く',
        url: 'https://...', inputs: [{ inputId: 'I1', label: '結果', inputType: 'text', required: true }],
        completionCriteria: '客観的に確認できる完了条件',
        verification: { method: 'visual | command | value_match', detail: '表示される文言 / 実行する確認コマンドと期待出力 / 一致すべき値' },
        failureRecovery: { checks: ['失敗時に確認する点'], resumeFrom: 'S1' },
        scopeNote: 'このステップで変わらないこと・やらないこと',
        evidenceRefs: ['L-001'], sourceReferences: []
      }],
      sourceSnapshots: (context.selectedSources || []).map(function (source) { return { fileId: source.fileId, fileName: source.fileName, snapshotAt: source.snapshotAt }; })
    }, null, 2),
    '',
    '作業の骨格:',
    JSON.stringify(context.skeleton, null, 2),
    '',
    '事実台帳（confirmed）:',
    JSON.stringify(context.confirmedEntries, null, 2),
    '',
    '作業前に確認へ降格されたエントリ（prerequisites へ必ず反映する）:',
    JSON.stringify(context.deferredEntries, null, 2),
    '',
    '入力コンテキスト:',
    JSON.stringify({
      action: context.action, meeting: context.meeting, allowedScripts: context.allowedScripts,
      selectedSources: (context.selectedSources || []).map(function (source) { return { fileId: source.fileId, fileName: source.fileName, snapshotAt: source.snapshotAt }; }),
      workGuideId: context.workGuideId || '', version: context.version || 1
    }, null, 2)
  ].join('\n');
}

// P4: 机上実行レビュー（生成とは別ロール・別コンテキストで1回）。
// 台帳はあえて渡さない — 初見の作業者と同じ条件にする（§8）。
function buildDeskReviewPrompt_(guide, options) {
  options = options || {};
  const findingSchema = JSON.stringify({
    passed: false,
    trace: ['Step 1 を実行中 → できたこと → 詰まり [MISSING_INFO]: 内容（どの記述か）'],
    findings: [{ stepRef: 'S2', slot: 'url | ui_label | input_value | verification | failure_recovery | precondition | caution | decision_rule | scope', type: 'MISSING_INFO', claim: '不足している情報の内容' }]
  }, null, 2);
  return [
    'あなたは、このガイドだけを渡された初見の作業者です。書いた経緯や会議の内容は知りません。',
    '上から順に、頭の中で実際に実行してください。各ステップについて実行トレースを書き、',
    '詰まった箇所を次のタイプで報告してください。',
    '',
    '- MISSING_INFO   : 実行に必要な情報が書かれていない',
    '- AMBIGUOUS_CHECK: 完了確認が人によって判定の分かれる書き方になっている',
    '- WRONG_ORDER    : この順では実行できない・前のステップの結果が足りない',
    '- RISK_UNFLAGGED : 失敗すると取り返しがつかないのに注意書きがない',
    '- JARGON         : 初見では意味の取れない用語・社内語',
    '',
    options.jsonOnly
      ? '出力は次の形式の JSON オブジェクトのみとする。詰まりが無ければ passed を true、findings を空配列にする。\n' + findingSchema
      : [
        'トレースの形式:',
        'Step n を実行中 → できたこと → 詰まり [タイプ]: 内容（どの記述か）',
        '',
        '最後に、結果を次の形式の ```json ブロックでまとめてください。',
        findingSchema,
        '詰まりが無ければ passed を true、findings を空配列にし、「完走」と書いてください。'
      ].join('\n'),
    '',
    workGuideQualityBar_(),
    '',
    'ガイド:',
    JSON.stringify(guide, null, 2)
  ].join('\n');
}

function buildWorkGuideRevisionPrompt_(guide, feedback) {
  return [
    'あなたは、作業ガイドJSONのドラフトを人間のレビュー指摘に基づいて修正します。',
    '次の制約を厳守してください。',
    '- 出力は修正後の作業ガイド JSON オブジェクト全体のみを ```json コードブロックで囲んで返す。コードブロックの前後に説明文を書かない。',
    '- schemaVersion / workGuideId / version は現在のドラフトの値を変更しない。',
    '- レビュー指摘の修正に加えて、下記の品質基準に達していない手順があれば同時に具体化する。それ以外の箇所は不要に変更しない。',
    '- 手順タイプは input または script のみ。各手順の description と completionCriteria は必須。手順を分割した場合は stepId を重複させず、order を1からの連番に振り直す。',
    '- sourceReferences には sourceSnapshots にある fileId だけを指定する。',
    '',
    workGuideQualityBar_(),
    '',
    '現在のドラフト:',
    JSON.stringify(guide, null, 2),
    '',
    'レビュー指摘:',
    feedback
  ].join('\n');
}

function buildWorkGuideDepthCheckPrompt_(guide, findings) {
  return [
    'あなたは、作業ガイドJSONのドラフトが品質基準に達しているかを点検し、不足を修正する検収者です。',
    '各手順を品質基準と照合し、抽象的な手順の分割、description への画面・操作・入力値・失敗時対処の追記、completionCriteria の客観化を行った修正版を返してください。',
    '次の制約を厳守してください。',
    '- 出力は修正後の作業ガイド JSON オブジェクト全体のみを ```json コードブロックで囲んで返す。コードブロックの前後に説明文を書かない。',
    '- schemaVersion / workGuideId / version / sourceSnapshots は現在のドラフトの値を変更しない。',
    '- 手順タイプは input または script のみ。手順を分割した場合は stepId を重複させず、order を1からの連番に振り直す。',
    '- sourceReferences には sourceSnapshots にある fileId だけを指定する。',
    '- 根拠のない事実を追加しない。分からない値は「作業前に確認: …」として prerequisites へ追加し、該当手順の description にも【要確認】と書く。',
    '',
    workGuideQualityBar_(),
    findings && findings.length ? '\nアプリの自動チェックで見つかった不足（すべて解消するか、解消できない理由を prerequisites へ残す）:\n' + findings.map(function (item, index) { return (index + 1) + '. ' + item; }).join('\n') : '',
    '',
    '現在のドラフト:',
    JSON.stringify(guide, null, 2)
  ].join('\n');
}

function buildWorkGuideAutoReviewPrompt_(context, guide) {
  return [
    'あなたは、作業ガイドの厳格な検収者兼編集者です。初稿を根拠資料と照合し、不足や曖昧さを直した最終稿を返します。',
    '出力は JSON オブジェクトのみです。コードブロックや説明文を付けないでください。',
    '- 初稿をそのまま承認せず、別の検収工程として事実根拠・実行可能性・完了条件・安全性を確認する。',
    '- 根拠にない事実は追加しない。不明点は prerequisites または remainingRisks に明記する。',
    '- 他資料を探さず、各手順を上から実行するだけで完了できる粒度へ修正する。',
    '- script 手順は allowedScripts に存在するIDだけを使用する。任意コードは生成しない。',
    '- workGuideId / version / schemaVersion / sourceSnapshots は初稿から変更しない。',
    '',
    workGuideQualityBar_(),
    '',
    '根拠コンテキスト:',
    JSON.stringify(context, null, 2),
    '',
    '初稿:',
    JSON.stringify(guide, null, 2),
    '',
    '出力スキーマ:',
    JSON.stringify({
      review: {
        summary: '検収結果の要約',
        issues: ['初稿で見つけた問題'],
        changesMade: ['最終稿へ反映した変更'],
        remainingRisks: ['人が承認時に確認すべき残存事項']
      },
      workGuide: guide
    }, null, 2)
  ].join('\n');
}

function buildAiJsonRepairPrompt_(originalPrompt, invalidResponse, errors) {
  return [
    '直前のJSON回答はアプリの検証に通りませんでした。次の検証エラーをすべて修正し、JSONオブジェクト全体だけを返してください。',
    '新しい事実は追加せず、元の依頼と根拠を維持してください。コードブロックや説明文は禁止です。',
    '',
    '検証エラー:',
    JSON.stringify(errors || [], null, 2),
    '',
    '元の依頼:',
    originalPrompt,
    '',
    '検証に失敗した回答:',
    invalidResponse
  ].join('\n');
}
