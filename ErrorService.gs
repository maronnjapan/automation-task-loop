function AppError(code, message, details) {
  this.name = 'AppError';
  this.code = code;
  this.message = message;
  this.details = details || null;
  this.stack = new Error(message).stack;
}
AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function assertApp_(condition, code, message, details) {
  if (!condition) throw new AppError(code, message, details);
}

function toClientError_(error) {
  console.error(error && error.stack ? error.stack : error);
  return {
    success: false,
    code: error && error.code ? error.code : 'UNEXPECTED_ERROR',
    error: error && error.message ? error.message : '予期しないエラーが発生しました。',
    details: error && error.details ? error.details : null
  };
}

function withClientError_(callback) {
  try {
    return callback();
  } catch (error) {
    return toClientError_(error);
  }
}
