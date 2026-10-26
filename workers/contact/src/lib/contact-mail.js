const CONTACT_FROM = 'bitbi.ai Kontaktformular <contact@contact.bitbi.ai>';
const CONTACT_SUBJECT_FALLBACK = 'Neue Anfrage über das Kontaktformular';
const CONTACT_SUBJECT_NAME_MAX = 100;
const CONTACT_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// C0/C1 controls, line and paragraph separators, bidi overrides/isolates, and zero-width format characters.
const SUBJECT_NAME_CONTROLS = /[\u0000-\u001F\u007F-\u009F\u061C\u180E\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g;

export function sanitizeHeaderValue(str) {
  return String(str ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

export function isValidContactEmail(email) {
  const safe = sanitizeHeaderValue(email);
  if (!safe || safe.length > 254) return false;
  return CONTACT_EMAIL_PATTERN.test(safe);
}

export function sanitizeContactSubjectName(value) {
  const collapsed = String(value ?? '')
    .replace(SUBJECT_NAME_CONTROLS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length <= CONTACT_SUBJECT_NAME_MAX) return collapsed;
  let capped = collapsed.slice(0, CONTACT_SUBJECT_NAME_MAX);
  const last = capped.charCodeAt(capped.length - 1);
  if (last >= 0xD800 && last <= 0xDBFF) capped = capped.slice(0, -1);
  return capped.trimEnd();
}

export function contactSubjectForName(name) {
  const safeName = sanitizeContactSubjectName(name);
  if (!safeName) return CONTACT_SUBJECT_FALLBACK;
  return `Neue Anfrage von ${safeName}`;
}

export function buildContactEmailPayload({ to, name, email, subject, message }) {
  const safeName = sanitizeHeaderValue(name);
  const safeEmail = sanitizeHeaderValue(email);
  const safeSubject = sanitizeHeaderValue(subject);
  const payload = {
    from: CONTACT_FROM,
    to: [to],
  };
  if (isValidContactEmail(safeEmail)) payload.replyTo = [safeEmail];
  payload.subject = contactSubjectForName(name);
  payload.text = `Name: ${safeName}\nEmail: ${safeEmail}\nSubject: ${safeSubject || '(none)'}\n\n${message}`;
  return payload;
}
