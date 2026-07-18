function createId_(prefix) {
  const now = new Date();
  const date = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  const lock = LockService.getScriptLock();
  const alreadyHeld = lock.hasLock();
  if (!alreadyHeld) lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const key = 'ID_SEQUENCE_' + prefix + '_' + date;
    const sequence = Number(properties.getProperty(key) || '0') + 1;
    properties.setProperty(key, String(sequence));
    return prefix + '-' + date + '-' + String(sequence).padStart(4, '0');
  } finally {
    if (!alreadyHeld) lock.releaseLock();
  }
}

function createUuid_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}
