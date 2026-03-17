import { nowIso, addMinutesIso, randomTokenHex, sha256Hex } from "./tokens.js";

export async function sendVerificationEmail(env, toEmail, verifyLink) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: "BITBI — Verify your email address",
      text: [
        "Hello,",
        "",
        "Thank you for registering at BITBI!",
        "",
        "Please verify your email address by clicking the following link:",
        verifyLink,
        "",
        "This link is valid for 60 minutes and can only be used once.",
        "",
        "If you did not register at BITBI, you can ignore this email.",
        "",
        "— BITBI",
      ].join("\n"),
      html: [
        '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#d4d4d4;background:#0a0a0a;padding:32px;border-radius:12px">',
        '<h2 style="color:#00F0FF;margin-top:0">Verify your email</h2>',
        "<p>Hello,</p>",
        "<p>Thank you for registering at BITBI!</p>",
        "<p>Please verify your email address:</p>",
        `<p><a href="${verifyLink}" style="display:inline-block;padding:12px 24px;background:#00F0FF;color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:600">Verify Email</a></p>`,
        '<p style="font-size:13px;color:#888">Or copy this link:</p>',
        `<p style="font-size:13px;word-break:break-all;color:#00F0FF">${verifyLink}</p>`,
        '<p style="font-size:13px;color:#888">This link is valid for 60 minutes and can only be used once.</p>',
        '<p style="font-size:13px;color:#888">If you did not register at BITBI, you can ignore this email.</p>',
        '<p style="margin-top:24px;color:#555">— BITBI</p>',
        "</div>",
      ].join(""),
    }),
  });

  return res.ok;
}

export async function createAndSendVerificationToken(env, userId, email) {
  const rawToken = randomTokenHex(32);
  const tokenHash = await sha256Hex(rawToken);
  const tokenId = crypto.randomUUID();
  const now = nowIso();
  const expiresAt = addMinutesIso(60);

  await env.DB.prepare(
    `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(tokenId, userId, tokenHash, expiresAt, now)
    .run();

  const verifyLink = `${env.APP_BASE_URL}/account/verify-email.html?token=${rawToken}`;
  try {
    await sendVerificationEmail(env, email, verifyLink);
  } catch (e) {
    console.error("Verification email failed:", e);
  }
}

export async function sendResetEmail(env, toEmail, resetLink) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [toEmail],
      subject: "BITBI — Reset your password",
      text: [
        "Hello,",
        "",
        "You requested a password reset for your BITBI account.",
        "",
        "Click the following link to set a new password:",
        resetLink,
        "",
        "This link is valid for 60 minutes and can only be used once.",
        "",
        "If you did not request this, you can ignore this email.",
        "",
        "— BITBI",
      ].join("\n"),
      html: [
        "<div style=\"font-family:sans-serif;max-width:480px;margin:0 auto;color:#d4d4d4;background:#0a0a0a;padding:32px;border-radius:12px\">",
        "<h2 style=\"color:#FFB300;margin-top:0\">Reset Password</h2>",
        "<p>Hello,</p>",
        "<p>You requested a password reset for your BITBI account.</p>",
        `<p><a href="${resetLink}" style="display:inline-block;padding:12px 24px;background:#00F0FF;color:#0a0a0a;text-decoration:none;border-radius:8px;font-weight:600">Set New Password</a></p>`,
        "<p style=\"font-size:13px;color:#888\">Or copy this link:</p>",
        `<p style="font-size:13px;word-break:break-all;color:#00F0FF">${resetLink}</p>`,
        "<p style=\"font-size:13px;color:#888\">This link is valid for 60 minutes and can only be used once.</p>",
        "<p style=\"font-size:13px;color:#888\">If you did not request this, you can ignore this email.</p>",
        "<p style=\"margin-top:24px;color:#555\">— BITBI</p>",
        "</div>",
      ].join(""),
    }),
  });

  return res.ok;
}
