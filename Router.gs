function getBootstrapData() {
  return withClientError_(function () {
    const settings = getAppSettings();
    const configured = Boolean(settings.rootFolderId && settings.spreadsheetId);
    if (!configured) return { success: true, configured: false, settings: settings };
    ensureManagementSchemaCurrent_();
    ensureFolderPath_(getRootFolder_(), APP_CONFIG.folderPaths.aiInteractionLogs);
    return {
      success: true,
      configured: true,
      settings: settings,
      counts: (function () {
        const completed = completedMeetingIds_();
        const guideMeeting = {};
        getRows_('WorkGuides').forEach(function (row) { guideMeeting[String(row.workGuideId)] = String(row.meetingId); });
        return {
          meetings: getRows_('Meetings').length,
          actions: getRows_('Actions').filter(function (row) { return row.status === 'candidate' && !completed[String(row.meetingId)]; }).length,
          guides: getRows_('WorkGuides').filter(function (row) { return !completed[String(row.meetingId)]; }).length,
          guidesAwaitingReview: getRows_('WorkGuides').filter(function (row) { return row.status === APP_CONFIG.statuses.guideNeedsReview && !completed[String(row.meetingId)]; }).length,
          activeExecutions: getRows_('WorkGuideExecutions').filter(function (row) { return (row.status === 'in_progress' || row.status === 'paused') && !completed[guideMeeting[String(row.workGuideId)]]; }).length
        };
      })()
    };
  });
}

function getDiagnostics() {
  return withClientError_(function () {
    return { success: true, diagnostics: runSetupDiagnostics() };
  });
}
