const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { createAuthTestEnv } = require('./helpers/auth-worker-harness');

const FIXED_FROM = 'bitbi.ai Kontaktformular <contact@contact.bitbi.ai>';
const SUBJECT_FALLBACK = 'Neue Anfrage über das Kontaktformular';
const TO_EMAIL = 'bit@bitbi.ai';

function legacyHeaderValue(value) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
}

async function loadContactWorker() {
  const filePath = path.join(process.cwd(), 'workers/contact/src/index.js');
  const mod = await import(pathToFileURL(filePath).href);
  return mod.default;
}

async function loadContactMail() {
  const filePath = path.join(process.cwd(), 'workers/contact/src/lib/contact-mail.js');
  return import(pathToFileURL(filePath).href);
}

function contactEnv() {
  const env = createAuthTestEnv();
  env.RESEND_API_KEY = 'test-key';
  return env;
}

function contactRequest(body, ip) {
  return new Request('https://contact.bitbi.ai/', {
    method: 'POST',
    headers: {
      Origin: 'https://bitbi.ai',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': ip,
    },
    body: JSON.stringify({ website: '', ...body }),
  });
}

function installResendMock() {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: 'email-1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return {
    calls,
    restore() {
      global.fetch = originalFetch;
    },
    payload(index = 0) {
      expect(calls[index]?.url).toBe('https://api.resend.com/emails');
      return JSON.parse(calls[index].options.body);
    },
  };
}

test.describe('Contact form mail headers', () => {
  test('uses a fixed From and sets Reply-To only from the visitor email', async () => {
    const worker = await loadContactWorker();
    const env = contactEnv();
    const resend = installResendMock();
    const name = 'Evil <evil@example.com>';
    const email = 'ada@example.com';
    const subject = 'Hello';
    const message = 'Line one\r\nLine two';

    try {
      const res = await worker.fetch(
        contactRequest({ name, email, subject, message }, '203.0.113.120'),
        env,
      );
      expect(res.status).toBe(200);
      const payload = resend.payload();
      expect(payload.from).toBe(FIXED_FROM);
      expect(payload.from).not.toContain('evil@example.com');
      expect(payload.to).toEqual([TO_EMAIL]);
      expect(payload.replyTo).toEqual([email]);
      expect(payload.subject).toBe('Neue Anfrage von Evil <evil@example.com>');
      expect(payload.text).toBe(
        `Name: ${name}\nEmail: ${email}\nSubject: ${subject}\n\n${message}`,
      );
    } finally {
      resend.restore();
    }
  });

  test('subject keeps a sanitized name and leaves the message body unchanged', async () => {
    const worker = await loadContactWorker();
    const env = contactEnv();
    const resend = installResendMock();
    const name = 'Ann\r\n \u0000\u001b\u007f\u0085\u009f\u061c\u180e\u200b\u200e\u200f\u2028\u202e\u2066\u2069\ufeffLovelace';
    const email = 'ada@example.com';
    const subject = 'Ignore\r\nBcc: evil@example.com';
    const message = 'Please help';
    const controls = [
      '\r', '\n', '\u0000', '\u001b', '\u007f', '\u0085', '\u009f', '\u061c', '\u180e',
      '\u200b', '\u200e', '\u200f', '\u2028', '\u202e', '\u2066', '\u2069', '\ufeff',
    ];

    try {
      const res = await worker.fetch(
        contactRequest({ name, email, subject, message }, '203.0.113.121'),
        env,
      );
      expect(res.status).toBe(200);
      const payload = resend.payload();
      expect(payload.from).toBe(FIXED_FROM);
      expect(payload.subject).toBe('Neue Anfrage von Ann Lovelace');
      expect(payload.subject).not.toContain('Ignore');
      expect(payload.subject).not.toContain('Bcc');
      for (const control of controls) expect(payload.subject).not.toContain(control);
      expect(payload.replyTo).toEqual([email]);
      expect(payload.text).toBe(
        `Name: ${legacyHeaderValue(name)}\nEmail: ${email}\nSubject: ${legacyHeaderValue(subject)}\n\n${message}`,
      );
      expect(payload.text).toContain('\u0085');
      expect(payload.text).toContain('\u202e');
      expect(payload.text).toContain('IgnoreBcc: evil@example.com');
    } finally {
      resend.restore();
    }
  });

  test('uses the fallback subject when the sanitized name is empty', async () => {
    const worker = await loadContactWorker();
    const env = contactEnv();
    const resend = installResendMock();
    const mail = await loadContactMail();
    const email = 'ada@example.com';
    const message = 'Hello';

    try {
      expect(mail.contactSubjectForName('   ')).toBe(SUBJECT_FALLBACK);
      expect(mail.contactSubjectForName('\u200b\u202e')).toBe(SUBJECT_FALLBACK);
      expect(mail.contactSubjectForName('')).toBe(SUBJECT_FALLBACK);

      const name = '\r\n \t\u200b\u202e';
      const res = await worker.fetch(
        contactRequest({ name, email, subject: '', message }, '203.0.113.122'),
        env,
      );
      expect(res.status).toBe(200);
      const payload = resend.payload();
      expect(payload.from).toBe(FIXED_FROM);
      expect(payload.subject).toBe(SUBJECT_FALLBACK);
      expect(payload.subject).not.toContain('von');
      expect(payload.replyTo).toEqual([email]);
      expect(payload.text).toBe(
        `Name: ${legacyHeaderValue(name)}\nEmail: ${email}\nSubject: (none)\n\n${message}`,
      );
      expect(payload.text.startsWith('Name: \u200b\u202e\n')).toBe(true);
    } finally {
      resend.restore();
    }
  });

  test('caps an overlong subject name and still rejects overlong submissions', async () => {
    const worker = await loadContactWorker();
    const env = contactEnv();
    const resend = installResendMock();
    const mail = await loadContactMail();
    const email = 'ada@example.com';

    try {
      const longName = 'N'.repeat(180);
      const built = mail.buildContactEmailPayload({
        to: TO_EMAIL,
        name: longName,
        email,
        subject: 'Hi',
        message: 'Body',
      });
      expect(built.from).toBe(FIXED_FROM);
      expect(built.subject).toBe(`Neue Anfrage von ${'N'.repeat(100)}`);
      expect(built.text.startsWith(`Name: ${longName}\n`)).toBe(true);
      expect(mail.sanitizeContactSubjectName(`${'A'.repeat(99)}\uD83D\uDE00`)).toBe('A'.repeat(99));
      expect(mail.contactSubjectForName('Ann\r\nLovelace')).toBe('Neue Anfrage von AnnLovelace');
      expect(mail.contactSubjectForName('Ann\tLovelace')).toBe('Neue Anfrage von AnnLovelace');
      expect(mail.contactSubjectForName('Ann \r\n Lovelace')).toBe('Neue Anfrage von Ann Lovelace');
      expect(mail.contactSubjectForName(`${'A'.repeat(90)}\r\n\u202e${'B'.repeat(30)}`)).toBe(
        `Neue Anfrage von ${'A'.repeat(90)}${'B'.repeat(10)}`,
      );

      const maxName = 'A'.repeat(100);
      const okRes = await worker.fetch(
        contactRequest({ name: maxName, email, subject: 'Hi', message: 'Body' }, '203.0.113.123'),
        env,
      );
      expect(okRes.status).toBe(200);
      const payload = resend.payload();
      expect(payload.from).toBe(FIXED_FROM);
      expect(payload.subject).toBe(`Neue Anfrage von ${maxName}`);
      expect(payload.text.startsWith(`Name: ${maxName}\n`)).toBe(true);

      const tooLong = await worker.fetch(
        contactRequest({ name: 'N'.repeat(101), email, subject: 'Hi', message: 'Body' }, '203.0.113.124'),
        env,
      );
      expect(tooLong.status).toBe(400);
      await expect(tooLong.json()).resolves.toEqual({
        error: 'One or more fields exceed the maximum allowed length',
      });
      expect(resend.calls).toHaveLength(1);
    } finally {
      resend.restore();
    }
  });

  test('sets Reply-To for a valid address and omits it when the address is invalid or missing', async () => {
    const worker = await loadContactWorker();
    const env = contactEnv();
    const resend = installResendMock();
    const mail = await loadContactMail();

    try {
      const valid = mail.buildContactEmailPayload({
        to: TO_EMAIL,
        name: 'Ada',
        email: '  ada@example.com\r\n',
        subject: 'Hi',
        message: 'Body',
      });
      expect(valid.replyTo).toEqual(['ada@example.com']);
      expect(valid.replyTo.join('')).not.toMatch(/[\r\n]/);
      expect(mail.buildContactEmailPayload({
        to: TO_EMAIL,
        name: 'Ada',
        email: 'a@b.c,d',
        subject: 'Hi',
        message: 'Body',
      }).replyTo).toEqual(['a@b.c,d']);

      for (const email of ['not-an-email', '', undefined, 'ada@example.com\r\nBcc: evil@example.com']) {
        const payload = mail.buildContactEmailPayload({
          to: TO_EMAIL,
          name: 'Ada',
          email,
          subject: 'Hi',
          message: 'Body',
        });
        expect(payload.from).toBe(FIXED_FROM);
        expect(Object.hasOwn(payload, 'replyTo')).toBe(false);
        expect(JSON.parse(JSON.stringify(payload)).replyTo).toBeUndefined();
        expect(payload.text).not.toMatch(/\r|\nBcc/);
      }

      const injected = mail.buildContactEmailPayload({
        to: TO_EMAIL,
        name: 'Ada',
        email: 'ada@example.com\r\nBcc: evil@example.com',
        subject: 'Hi',
        message: 'Body',
      });
      expect(injected.text.split('\n')[1]).toBe('Email: ada@example.comBcc: evil@example.com');

      const cleaned = await worker.fetch(
        contactRequest({
          name: 'Ada',
          email: 'ada@example.com\r\n',
          subject: 'Hi',
          message: 'Body',
        }, '203.0.113.125'),
        env,
      );
      expect(cleaned.status).toBe(200);
      const cleanedPayload = resend.payload();
      expect(cleanedPayload.replyTo).toEqual(['ada@example.com']);
      expect(cleanedPayload.from).toBe(FIXED_FROM);
      expect(JSON.stringify(cleanedPayload)).not.toContain('\\r');
      expect(JSON.stringify(cleanedPayload)).not.toContain('\\nBcc');

      const invalid = await worker.fetch(
        contactRequest({
          name: 'Ada',
          email: 'not-an-email',
          subject: 'Hi',
          message: 'Body',
        }, '203.0.113.126'),
        env,
      );
      expect(invalid.status).toBe(400);
      await expect(invalid.json()).resolves.toEqual({ error: 'Invalid email format' });

      const headerInjection = await worker.fetch(
        contactRequest({
          name: 'Ada',
          email: 'ada@example.com\r\nBcc: evil@example.com',
          subject: 'Hi',
          message: 'Body',
        }, '203.0.113.127'),
        env,
      );
      expect(headerInjection.status).toBe(400);
      await expect(headerInjection.json()).resolves.toEqual({ error: 'Invalid email format' });

      const missing = await worker.fetch(
        contactRequest({
          name: 'Ada',
          email: '',
          subject: 'Hi',
          message: 'Body',
        }, '203.0.113.128'),
        env,
      );
      expect(missing.status).toBe(400);
      await expect(missing.json()).resolves.toEqual({ error: 'Missing required fields' });
      expect(resend.calls).toHaveLength(1);
    } finally {
      resend.restore();
    }
  });
});
