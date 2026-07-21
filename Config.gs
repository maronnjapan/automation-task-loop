/**
 * Application-wide constants and configuration accessors.
 * Secret or environment-specific IDs live in Script Properties, never here.
 */
const APP_CONFIG = Object.freeze({
  appName: '会議作業管理',
  schemaVersion: '1.1',
  rootFolderName: '会議作業管理',
  managementSpreadsheetName: '管理スプレッドシート',
  propertyKeys: Object.freeze({
    rootFolderId: 'ROOT_FOLDER_ID',
    spreadsheetId: 'MANAGEMENT_SPREADSHEET_ID',
    setupCompletedAt: 'SETUP_COMPLETED_AT',
    aiProvider: 'AI_PROVIDER',
    aiApiKey: 'AI_API_KEY',
    aiModel: 'AI_MODEL',
    legacyOpenAiApiKey: 'OPENAI_API_KEY',
    legacyOpenAiModel: 'OPENAI_MODEL',
    aiAutomationEnabled: 'AI_AUTOMATION_ENABLED',
    aiDataConsent: 'AI_DATA_CONSENT',
    aiMaxRepairAttempts: 'AI_MAX_REPAIR_ATTEMPTS',
    managementSchemaVersion: 'MANAGEMENT_SCHEMA_VERSION'
  }),
  folderPaths: Object.freeze({
    transcripts: ['01_文字起こし'],
    transcriptsDone: ['01_文字起こし', '完了'],
    analysisSummaries: ['02_会議解析', '要約'],
    analysisJson: ['02_会議解析', 'AI回答JSON'],
    aiInteractionLogs: ['02_会議解析', 'AI対話履歴'],
    guideDrafts: ['03_作業ガイド', '作成途中'],
    guideReady: ['03_作業ガイド', '実行可能'],
    guideNeedsReview: ['03_作業ガイド', '要確認'],
    guideArchive: ['03_作業ガイド', 'アーカイブ'],
    executionResults: ['04_作業ガイド実行結果'],
    sourceSnapshots: ['05_参照資料スナップショット'],
    management: ['99_管理']
  }),
  categories: Object.freeze(['未分類', '定例', 'プロジェクト', '顧客', '社内', 'その他']),
  statuses: Object.freeze({
    guideDraft: 'draft',
    guideReady: 'ready',
    guideNeedsReview: 'needs_review',
    executionInProgress: 'in_progress',
    executionPaused: 'paused',
    executionCompleted: 'completed'
  }),
  cacheSeconds: 21600,
  maxTranscriptCharacters: 120000,
  maxSourceCharacters: 30000,
  defaultAiProvider: 'openai',
  defaultAiModels: Object.freeze({
    openai: 'gpt-5.6-terra',
    gemini: 'gemini-2.5-flash',
    anthropic: 'claude-opus-4-8',
    openrouter: ''
  }),
  defaultAiMaxRepairAttempts: 1,
  automationTimeBudgetMs: 240000,
  managementSchemaVersion: '2026-07-ai-automation-v1'
});

const SHEET_DEFINITIONS = Object.freeze({
  Meetings: ['meetingId', 'title', 'category', 'transcriptFileId', 'meetingEndedAt', 'registeredAt', 'analysisStatus', 'workflowStatus', 'completedAt', 'automationStatus', 'automationAttempts', 'automationError', 'automationUpdatedAt'],
  MeetingAnalyses: ['meetingId', 'summaryFileId', 'analysisJsonFileId', 'summary', 'decisionsJson', 'pendingItemsJson', 'quizJson', 'analyzedAt'],
  Actions: ['actionId', 'meetingId', 'title', 'description', 'owner', 'dueDate', 'status', 'prerequisiteQuestionsJson', 'createdAt', 'guideRecommended', 'automationStatus', 'automationAttempts', 'automationError'],
  QuizSessions: ['quizSessionId', 'meetingId', 'mode', 'status', 'answersJson', 'questionStatesJson', 'scoreJson', 'updatedAt'],
  WorkGuideBuildSessions: ['buildSessionId', 'actionId', 'meetingId', 'currentStep', 'status', 'dataJson', 'createdAt', 'updatedAt'],
  WorkGuides: ['workGuideId', 'actionId', 'meetingId', 'title', 'status', 'currentVersion', 'documentFileId', 'jsonFileId', 'createdAt', 'updatedAt', 'lastExecutedAt', 'reviewedAt', 'reviewNote', 'generationMode', 'autoReviewJson'],
  WorkGuideVersions: ['workGuideVersionId', 'workGuideId', 'versionNo', 'goal', 'assumptionsJson', 'prerequisitesJson', 'warningsJson', 'stepsJson', 'sourceSnapshotsJson', 'documentFileId', 'jsonFileId', 'createdAt'],
  WorkGuideExecutions: ['executionId', 'workGuideId', 'workGuideVersionId', 'status', 'currentStepId', 'startedAt', 'pausedAt', 'completedAt', 'executionDataJson', 'notes'],
  AllowedActionRegistry: ['scriptId', 'name', 'description', 'paramsJson', 'impactNote', 'registeredAt'],
  SaveRequests: ['requestToken', 'workGuideId', 'versionNo', 'resultJson', 'createdAt'],
  AiInteractions: ['interactionId', 'conversationId', 'meetingId', 'actionId', 'workGuideId', 'buildSessionId', 'phase', 'iteration', 'provider', 'model', 'requestFileId', 'responseFileId', 'requestPreview', 'responsePreview', 'status', 'validationJson', 'error', 'createdAt']
});

function getAppSettings() {
  const properties = PropertiesService.getScriptProperties();
  return {
    rootFolderId: properties.getProperty(APP_CONFIG.propertyKeys.rootFolderId) || '',
    spreadsheetId: properties.getProperty(APP_CONFIG.propertyKeys.spreadsheetId) || '',
    setupCompletedAt: properties.getProperty(APP_CONFIG.propertyKeys.setupCompletedAt) || '',
    categories: APP_CONFIG.categories.slice(),
    appName: APP_CONFIG.appName,
    schemaVersion: APP_CONFIG.schemaVersion,
    aiAutomation: getAiAutomationSettings_()
  };
}

function requireConfigured_() {
  const settings = getAppSettings();
  if (!settings.rootFolderId || !settings.spreadsheetId) {
    throw new Error('初期設定が完了していません。Apps Script エディタから runSetupGuide() を実行してください。');
  }
  return settings;
}
