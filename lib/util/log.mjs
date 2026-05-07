const LEVELS = { info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

function emit(level, msg) {
  const stamp = new Date().toISOString();
  process.stderr.write(`${stamp} ${level} ${msg}\n`);
}

export const log = {
  info: (msg) => emit(LEVELS.info, msg),
  warn: (msg) => emit(LEVELS.warn, msg),
  error: (msg) => emit(LEVELS.error, msg),
};
