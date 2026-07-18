function getBootstrapData() {
  return withClientError_(function () {
    const settings = getAppSettings();
    const configured = Boolean(settings.rootFolderId && settings.spreadsheetId);
    if (!configured) return { success: true, configured: false, settings: settings };
    return {
      success: true,
      configured: true,
      settings: settings,
      counts: {
        meetings: getRows_('Meetings').length,
        actions: getRows_('Actions').filter(function (row) { return row.status === 'candidate'; }).length,
        guides: getRows_('WorkGuides').length,
        activeExecutions: getRows_('WorkGuideExecutions').filter(function (row) { return row.status === 'in_progress' || row.status === 'paused'; }).length
      }
    };
  });
}

function getDiagnostics() {
  return withClientError_(function () {
    return { success: true, diagnostics: runSetupDiagnostics() };
  });
}
