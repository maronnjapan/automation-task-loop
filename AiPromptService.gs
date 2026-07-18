function buildMeetingAnalysisPrompt_(meeting, transcript) {
  return [
    'あなたは会議ログを、本人が直後に理解し、必要な作業だけをガイド化できる形へ構造化します。',
    '次の制約を厳守してください。',
    '- 出力は JSON オブジェクトのみ。Markdown のコードフェンスや前後の説明は禁止。',
    '- 文字起こしにない事実を推測しない。不明点は pendingItems に入れる。',
    '- クイズは重要事項の件数に応じた必要十分な数にし、重複・些末な問題を避ける。',
    '- single_choice は3択か4択、true_false は2択、multi_choice は正解を複数指定する。自由記述は禁止。',
    '- correctChoiceIndexes は0始まりの整数配列。',
    '- 各作業候補に、ガイド作成前に本人へ聞く prerequisiteQuestions を含める。',
    '',
    '会議情報:',
    JSON.stringify({ meetingId: meeting.meetingId, title: meeting.title, category: meeting.category, meetingEndedAt: meeting.meetingEndedAt }, null, 2),
    '',
    '出力スキーマ:',
    JSON.stringify({
      summary: '会議の目的・背景・結論が分かる要約',
      decisions: ['決定事項（理由を含める）'],
      pendingItems: ['未決事項'],
      actionCandidates: [{ title: '作業名', description: '完了状態を含む説明', owner: '担当者', dueDate: 'ISO日付または空文字', prerequisiteQuestions: ['不足前提を確認する選択・短文質問'] }],
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
    '出力は JSON オブジェクトのみ。Markdown のコードフェンスや前後の説明は禁止です。',
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
