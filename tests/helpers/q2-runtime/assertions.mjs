export const check = (condition, label) => {
  if (!condition) { const error = new Error(label); error.name = 'Q2OracleError'; throw error; }
};

export async function expectNativeRejection(operation, expectedMarker) {
  let failure;
  try { await operation(); } catch (error) { failure = error; }
  check(Boolean(failure), `Expected native rejection: ${expectedMarker}`);
  const messages = [];
  for (let error = failure, depth = 0; error && depth < 4; error = error.cause, depth += 1) messages.push(String(error.message || ''));
  check(messages.some(message => message.includes(expectedMarker)), `Expected native constraint marker: ${expectedMarker}`);
}

export function safeError(error) {
  const scalar = value => typeof value === 'number' || typeof value === 'boolean' ? value
    : typeof value === 'string' && /^[a-z0-9_. -]{1,80}$/i.test(value) ? value : undefined;
  const message = String(error?.message || error).split('\n')[0].slice(0, 400);
  return { name: String(error?.name || 'Error'),
    message: /secret|cookie|token|recovery|password|authorization/i.test(message)
      ? '[sensitive-context diagnostic omitted]' : message.replace(/https?:\/\/[^ ]+/g, '[URL]'),
    actual: scalar(error?.actual), expected: scalar(error?.expected) };
}
