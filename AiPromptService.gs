function buildMeetingAnalysisPrompt_(meeting, transcript) {
  return [
    'あなたは会議ログを、本人が直後に理解し、必要な作業だけをガイド化できる形へ構造化します。',
    '次の制約を厳守してください。',
    '- 出力は JSON オブジェクトのみを ```json コードブロックで囲んで返す。コードブロックの前後に説明文を書かない。',
    '- 文字起こしにない事実を推測しない。不明点は pendingItems に入れる。',
    '- クイズは重要事項の件数に応じた必要十分な数にし、重複・些末な問題を避ける。',
    '- single_choice は3択か4択、true_false は2択、multi_choice は正解を複数指定する。自由記述は禁止。',
    '- correctChoiceIndexes は0始まりの整数配列。',
    '- actionCandidates は本人が実行・確認・委譲する具体的な作業だけにする。他者だけの作業や単なる情報共有は含めない。',
    '- 各作業候補に、ガイド作成前に本人へ聞く prerequisiteQuestions を含める。',
    '- 会議ログだけで実行可能なガイドを作る価値がある具体作業は guideRecommended=true、それ以外は false にする。',
    '',
    '会議情報:',
    JSON.stringify({ meetingId: meeting.meetingId, title: meeting.title, category: meeting.category, meetingEndedAt: meeting.meetingEndedAt }, null, 2),
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

function buildWorkGuidePrompt_(context) {
  return [
    'あなたは、他資料を探さずに最後まで実行できる作業ガイドを作ります。',
    '出力は JSON オブジェクトのみを ```json コードブロックで囲んで返してください。コードブロックの前後に説明文を書かないでください。',
    'workGuideId と version は入力コンテキストの値をそのまま使います。workGuideId が空文字の場合は空文字のままにし、新しいIDを発明しないでください。',
    'schemaVersion は 1.1。correctChoiceIndexes と同様、配列や型を厳密に守ってください。',
    '手順タイプは input または script のみです。表示専用手順は禁止です。',
    '各手順には具体的な description と completionCriteria が必須です。作業対象URLが分かる場合は必ず url に設定します。',
    'script は allowedScripts にある scriptId だけ使用できます。不適切なら input にします。',
    'sourceReferences には selectedSources の fileId だけを指定します。',
    '',
    '入力コンテキスト:',
    JSON.stringify(context, null, 2),
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

function buildWorkGuideRevisionPrompt_(guide, feedback) {
  return [
    'あなたは、作業ガイドJSONのドラフトを人間のレビュー指摘に基づいて修正します。',
    '次の制約を厳守してください。',
    '- 出力は修正後の作業ガイド JSON オブジェクト全体のみを ```json コードブロックで囲んで返す。コードブロックの前後に説明文を書かない。',
    '- schemaVersion / workGuideId / version は現在のドラフトの値を変更しない。',
    '- レビュー指摘に関係しない箇所は不要に変更しない。',
    '- 手順タイプは input または script のみ。各手順の description と completionCriteria は必須。',
    '- sourceReferences には sourceSnapshots にある fileId だけを指定する。',
    '',
    '現在のドラフト:',
    JSON.stringify(guide, null, 2),
    '',
    'レビュー指摘:',
    feedback
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
