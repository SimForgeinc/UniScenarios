const MODEL_ACCESS_FAILURE = /vision preflight failed|no credential available|usage limit|authentication_error|rate_limit_error/i;

export function modelAccessFailure(value) {
  if (value == null) return false;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return MODEL_ACCESS_FAILURE.test(text);
}
