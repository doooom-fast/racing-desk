// Anything the livery manager can fail at, in a shape the UI can render: a message, plus a `kind` for callers
// that care whether it was a refusal — the app declined to do something unsafe — or a plain failure. Ported
// from apps/paints/src-tauri/src/error.rs; the Rust serialised every variant to its message alone, so the
// message is the contract and `kind` is a convenience.
class AppError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'AppError';
    this.kind = kind;
  }
}

// A refusal, not a crash: the app declined to do something unsafe.
function refused(message) {
  return new AppError('refused', message);
}

function other(message) {
  return new AppError('other', message);
}

// The text of any error, for interpolating into the user-facing messages the Rust built with `{e}`.
function messageOf(e) {
  if (e == null) return String(e);
  if (typeof e === 'string') return e;
  return e.message || String(e);
}

module.exports = { AppError, refused, other, messageOf };
