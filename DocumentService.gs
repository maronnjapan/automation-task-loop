function createMeetingSummaryDocument_(meeting, analysis) {
  const document = DocumentApp.create(meeting.title + '_会議解析');
  const body = document.getBody();
  body.appendParagraph(meeting.title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('会議ID: ' + meeting.meetingId);
  body.appendParagraph('解析日時: ' + nowIso_());
  appendDocumentSection_(body, '要約', [analysis.summary]);
  appendDocumentSection_(body, '決定事項', normalizeTextItems_(analysis.decisions));
  appendDocumentSection_(body, '未決事項', normalizeTextItems_(analysis.pendingItems));
  appendDocumentSection_(body, '作業候補', analysis.actionCandidates.map(function (action) { return action.title + ': ' + action.description; }));
  document.saveAndClose();
  const file = DriveApp.getFileById(document.getId());
  file.moveTo(getFolderByPath_(APP_CONFIG.folderPaths.analysisSummaries));
  return file;
}

function createWorkGuideDocument_(guide) {
  const document = DocumentApp.create(guide.title);
  const body = document.getBody();
  body.appendParagraph(guide.title).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph('作業ガイドID: ' + guide.workGuideId + ' / バージョン: ' + guide.version);
  body.appendParagraph('作成日時: ' + nowIso_());
  appendDocumentSection_(body, '目的', [guide.goal]);
  appendDocumentSection_(body, '背景', guide.assumptions);
  appendDocumentSection_(body, '前提条件・必要な権限', guide.prerequisites);
  appendDocumentSection_(body, '必要な資料', guide.sourceSnapshots.map(function (source) { return source.fileName + ' (' + source.fileId + ')'; }));
  appendDocumentSection_(body, '注意事項', guide.warnings);
  body.appendParagraph('作業手順').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  guide.steps.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (step) {
    body.appendParagraph(step.order + '. ' + step.title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
    if (step.scopeNote) body.appendParagraph('このステップで変わらないこと: ' + step.scopeNote);
    body.appendParagraph(step.description);
    if (step.url) body.appendParagraph('URL: ' + step.url);
    if (step.inputs && step.inputs.length) {
      body.appendParagraph('入力・確認項目:');
      step.inputs.forEach(function (input) { body.appendListItem(input.label + (input.required ? '（必須）' : '')); });
    }
    if (step.type === 'script') body.appendParagraph('登録スクリプト: ' + step.scriptId);
    body.appendParagraph('完了条件: ' + step.completionCriteria).editAsText().setBold(true);
    if (step.verification && step.verification.detail) body.appendParagraph('完了確認（' + (step.verification.method || 'visual') + '）: ' + step.verification.detail);
    if (step.failureRecovery && step.failureRecovery.checks && step.failureRecovery.checks.length) {
      body.appendParagraph('失敗した場合に確認する点:');
      step.failureRecovery.checks.forEach(function (check) { body.appendListItem(check); });
      if (step.failureRecovery.resumeFrom) body.appendParagraph('やり直す手順: ' + step.failureRecovery.resumeFrom);
    }
    if (step.evidenceRefs && step.evidenceRefs.length) body.appendParagraph('根拠台帳エントリ: ' + step.evidenceRefs.join(', '));
    if (step.sourceReferences && step.sourceReferences.length) body.appendParagraph('参照資料ID: ' + step.sourceReferences.join(', '));
  });
  document.saveAndClose();
  return DriveApp.getFileById(document.getId());
}

function appendDocumentSection_(body, title, items) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (!items || !items.length) {
    body.appendParagraph('なし');
    return;
  }
  items.forEach(function (item) { body.appendListItem(String(item)); });
}

function normalizeTextItems_(items) {
  return (items || []).map(function (item) {
    if (typeof item === 'string') return item;
    if (item && item.title && item.description) return item.title + ': ' + item.description;
    return JSON.stringify(item);
  });
}
