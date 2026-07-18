function validateMeetingAnalysisJson(rawText) {
  return withClientError_(function () {
    const analysis = validateMeetingAnalysis_(parsePastedJson_(rawText));
    return { success: true, analysis: analysis };
  });
}

function validateWorkGuideJson(rawText, expectedWorkGuideId) {
  return withClientError_(function () {
    const guide = validateWorkGuide_(parsePastedJson_(rawText), { expectedWorkGuideId: expectedWorkGuideId || '' });
    return { success: true, workGuide: guide };
  });
}
