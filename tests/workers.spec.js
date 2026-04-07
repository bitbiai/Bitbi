const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const {
  createAuthTestEnv,
  createExecutionContext,
  loadWorker,
  nowIso,
  seedSession,
} = require('./helpers/auth-worker-harness');

async function loadAuthModules() {
  const passwordPath = pathToFileURL(path.join(process.cwd(), 'workers/auth/src/lib/passwords.js')).href;
  return import(passwordPath);
}

function authJsonRequest(pathname, method, body, headers = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  return new Request(`https://bitbi.ai${pathname}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function parseSessionCookie(setCookie) {
  return setCookie.split(';')[0];
}

test.describe('Worker routes', () => {
  test('auth happy path: login, me, logout', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const { hashPassword } = await loadAuthModules();
    const env = createAuthTestEnv({
      users: [
        {
          id: 'user-auth',
          email: 'member@example.com',
          password_hash: await hashPassword('password123', { PBKDF2_ITERATIONS: '100000' }),
          created_at: '2026-04-01T00:00:00.000Z',
          status: 'active',
          role: 'user',
          email_verified_at: '2026-04-01T00:10:00.000Z',
          verification_method: 'email_verified',
        },
      ],
    });

    const loginCtx = createExecutionContext();
    const loginRes = await authWorker.fetch(
      authJsonRequest('/api/login', 'POST', {
        email: 'member@example.com',
        password: 'password123',
      }, { Origin: 'https://bitbi.ai', 'CF-Connecting-IP': '203.0.113.10' }),
      env,
      loginCtx.execCtx
    );
    await loginCtx.flush();

    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.ok).toBe(true);
    expect(loginBody.user.email).toBe('member@example.com');
    const setCookie = loginRes.headers.get('Set-Cookie');
    expect(setCookie).toContain('bitbi_session=');
    expect(env.DB.state.sessions).toHaveLength(1);

    const meRes = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: parseSessionCookie(setCookie),
      }),
      env,
      createExecutionContext().execCtx
    );
    expect(meRes.status).toBe(200);
    await expect(meRes.json()).resolves.toMatchObject({
      loggedIn: true,
      user: { email: 'member@example.com', role: 'user' },
    });

    const logoutCtx = createExecutionContext();
    const logoutRes = await authWorker.fetch(
      authJsonRequest('/api/logout', 'POST', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: parseSessionCookie(setCookie),
        'CF-Connecting-IP': '203.0.113.10',
      }),
      env,
      logoutCtx.execCtx
    );
    await logoutCtx.flush();

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(env.DB.state.sessions).toHaveLength(0);

    const meAfterLogout = await authWorker.fetch(
      authJsonRequest('/api/me', 'GET', undefined, {
        Cookie: parseSessionCookie(setCookie),
      }),
      env,
      createExecutionContext().execCtx
    );
    await expect(meAfterLogout.json()).resolves.toMatchObject({
      loggedIn: false,
      user: null,
    });
  });

  test('admin destructive path: delete user without AI-owned records', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'admin-1',
          email: 'admin@example.com',
          password_hash: 'unused',
          created_at: '2026-04-01T00:00:00.000Z',
          status: 'active',
          role: 'admin',
          email_verified_at: '2026-04-01T00:00:00.000Z',
          verification_method: 'email_verified',
        },
        {
          id: 'user-plain',
          email: 'user@example.com',
          password_hash: 'unused',
          created_at: '2026-04-01T00:00:00.000Z',
          status: 'active',
          role: 'user',
          email_verified_at: '2026-04-01T00:00:00.000Z',
          verification_method: 'email_verified',
        },
      ],
      profiles: [
        {
          user_id: 'user-plain',
          display_name: 'User Plain',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: '2026-04-01T00:00:00.000Z',
          updated_at: '2026-04-01T00:00:00.000Z',
        },
      ],
    });

    const adminToken = await seedSession(env, 'admin-1');
    const exec = createExecutionContext();
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/users/user-plain', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${adminToken}`,
        'CF-Connecting-IP': '203.0.113.11',
      }),
      env,
      exec.execCtx
    );
    await exec.flush();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      deletedUserId: 'user-plain',
    });
    expect(env.DB.state.users.some((user) => user.id === 'user-plain')).toBe(false);
    expect(env.DB.state.adminAuditLog).toHaveLength(1);
    expect(env.DB.state.adminAuditLog[0].action).toBe('delete_user');
  });

  test('AI lifecycle: save image then delete image removes metadata and blob', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'artist-1',
          email: 'artist@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
    });

    const token = await seedSession(env, 'artist-1');
    const pngPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0uUAAAAASUVORK5CYII=';

    const saveRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/save', 'POST', {
        imageData: pngPixel,
        prompt: 'tiny test image',
        model: '@cf/test-model',
      }, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(saveRes.status).toBe(201);
    const saveBody = await saveRes.json();
    expect(saveBody.ok).toBe(true);
    const imageId = saveBody.data.id;
    const savedRow = env.DB.state.aiImages.find((row) => row.id === imageId);
    expect(savedRow).toBeTruthy();
    expect(env.USER_IMAGES.objects.has(savedRow.r2_key)).toBe(true);

    const deleteRes = await authWorker.fetch(
      authJsonRequest(`/api/ai/images/${imageId}`, 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.aiImages.some((row) => row.id === imageId)).toBe(false);
    expect(env.USER_IMAGES.objects.has(savedRow.r2_key)).toBe(false);
    expect(env.DB.state.r2CleanupQueue).toHaveLength(0);
  });

  test('AI single delete keeps a durable cleanup entry when inline blob deletion fails', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'artist-2',
          email: 'artist2@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiImages: [
        {
          id: 'deadbeef',
          user_id: 'artist-2',
          folder_id: null,
          r2_key: 'users/artist-2/folders/unsorted/deadbeef.png',
          prompt: 'existing image',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/artist-2/folders/unsorted/deadbeef.png': {
          body: new Uint8Array([1, 2, 3]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
      },
    });

    const token = await seedSession(env, 'artist-2');
    const deleteRes = await authWorker.fetch(
      authJsonRequest('/api/ai/images/deadbeef', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.aiImages).toHaveLength(0);
    expect(env.DB.state.r2CleanupQueue).toHaveLength(1);
    expect(env.DB.state.r2CleanupQueue[0].r2_key).toBe('users/artist-2/folders/unsorted/deadbeef.png');
    expect(env.USER_IMAGES.objects.has('users/artist-2/folders/unsorted/deadbeef.png')).toBe(true);
  });

  test('AI folder delete keeps durable cleanup entries when inline blob deletion fails', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'artist-3',
          email: 'artist3@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      aiFolders: [
        {
          id: 'abc123ef',
          user_id: 'artist-3',
          name: 'Archive',
          slug: 'archive',
          status: 'active',
          created_at: nowIso(),
        },
      ],
      aiImages: [
        {
          id: 'aa11',
          user_id: 'artist-3',
          folder_id: 'abc123ef',
          r2_key: 'users/artist-3/folders/archive/aa11.png',
          prompt: 'one',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
        {
          id: 'bb22',
          user_id: 'artist-3',
          folder_id: 'abc123ef',
          r2_key: 'users/artist-3/folders/archive/bb22.png',
          prompt: 'two',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/artist-3/folders/archive/aa11.png': {
          body: new Uint8Array([1]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
        'users/artist-3/folders/archive/bb22.png': {
          body: new Uint8Array([2]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
      },
    });

    const token = await seedSession(env, 'artist-3');
    const deleteRes = await authWorker.fetch(
      authJsonRequest('/api/ai/folders/abc123ef', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${token}`,
      }),
      env,
      createExecutionContext().execCtx
    );

    expect(deleteRes.status).toBe(200);
    await expect(deleteRes.json()).resolves.toMatchObject({ ok: true });
    expect(env.DB.state.aiFolders).toHaveLength(0);
    expect(env.DB.state.aiImages).toHaveLength(0);
    expect(env.DB.state.r2CleanupQueue.map((row) => row.r2_key).sort()).toEqual([
      'users/artist-3/folders/archive/aa11.png',
      'users/artist-3/folders/archive/bb22.png',
    ]);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/aa11.png')).toBe(true);
    expect(env.USER_IMAGES.objects.has('users/artist-3/folders/archive/bb22.png')).toBe(true);
  });

  test('contact worker: accepts allowed origin and rejects forbidden origin', async () => {
    const contactWorker = await loadWorker('workers/contact/src/index.js');
    const originalFetch = global.fetch;
    const resendCalls = [];

    global.fetch = async (url, options = {}) => {
      resendCalls.push({ url: String(url), options });
      return new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const okRes = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://bitbi.ai',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.12',
          },
          body: JSON.stringify({
            name: 'Visitor',
            email: 'visitor@example.com',
            subject: 'Hello',
            message: 'Testing contact worker',
            website: '',
          }),
        }),
        { RESEND_API_KEY: 'test-key' }
      );

      expect(okRes.status).toBe(200);
      await expect(okRes.json()).resolves.toMatchObject({ ok: true });
      expect(resendCalls).toHaveLength(1);
      expect(resendCalls[0].url).toBe('https://api.resend.com/emails');

      const forbiddenRes = await contactWorker.fetch(
        new Request('https://contact.bitbi.ai/', {
          method: 'POST',
          headers: {
            Origin: 'https://evil.example',
            'Content-Type': 'application/json',
            'CF-Connecting-IP': '203.0.113.13',
          },
          body: JSON.stringify({
            name: 'Bad',
            email: 'bad@example.com',
            subject: 'Blocked',
            message: 'Should not pass',
            website: '',
          }),
        }),
        { RESEND_API_KEY: 'test-key' }
      );

      expect(forbiddenRes.status).toBe(403);
      expect(await forbiddenRes.text()).toBe('Forbidden');
      expect(resendCalls).toHaveLength(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('admin delete succeeds for AI-owning users and preserves retained activity history', async () => {
    const authWorker = await loadWorker('workers/auth/src/index.js');
    const env = createAuthTestEnv({
      users: [
        {
          id: 'admin-2',
          email: 'admin2@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'admin',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
        {
          id: 'feedface',
          email: 'creator@example.com',
          password_hash: 'unused',
          created_at: nowIso(),
          status: 'active',
          role: 'user',
          email_verified_at: nowIso(),
          verification_method: 'email_verified',
        },
      ],
      profiles: [
        {
          user_id: 'feedface',
          display_name: 'Creator',
          bio: '',
          website: '',
          youtube_url: '',
          created_at: nowIso(),
          updated_at: nowIso(),
        },
      ],
      favorites: [
        {
          id: 1,
          user_id: 'feedface',
          item_type: 'gallery',
          item_id: 'g-1',
          title: 'Favorite',
          thumb_url: '/thumb.png',
          created_at: nowIso(),
        },
      ],
      aiFolders: [
        {
          id: 'c0ffee12',
          user_id: 'feedface',
          name: 'Projects',
          slug: 'projects',
          status: 'active',
          created_at: nowIso(),
        },
      ],
      aiImages: [
        {
          id: 'ab12cd34',
          user_id: 'feedface',
          folder_id: 'c0ffee12',
          r2_key: 'users/feedface/folders/projects/ab12cd34.png',
          prompt: 'portrait',
          model: '@cf/test-model',
          steps: 4,
          seed: null,
          created_at: nowIso(),
        },
      ],
      aiGenerationLog: [
        {
          id: 'gen-1',
          user_id: 'feedface',
          created_at: nowIso(),
        },
      ],
      userActivityLog: [
        {
          id: 'activity-1',
          user_id: 'feedface',
          action: 'login',
          meta_json: JSON.stringify({ email: 'creator@example.com' }),
          ip_address: '203.0.113.20',
          created_at: nowIso(),
        },
      ],
      userImages: {
        'users/feedface/folders/projects/ab12cd34.png': {
          body: new Uint8Array([7, 8, 9]).buffer,
          httpMetadata: { contentType: 'image/png' },
          failDelete: true,
        },
      },
      privateMedia: {
        'avatars/feedface': {
          body: new Uint8Array([4, 5]).buffer,
          httpMetadata: { contentType: 'image/png' },
        },
      },
    });

    const adminToken = await seedSession(env, 'admin-2');
    const exec = createExecutionContext();
    const res = await authWorker.fetch(
      authJsonRequest('/api/admin/users/feedface', 'DELETE', undefined, {
        Origin: 'https://bitbi.ai',
        Cookie: `bitbi_session=${adminToken}`,
        'CF-Connecting-IP': '203.0.113.14',
      }),
      env,
      exec.execCtx
    );
    await exec.flush();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      deletedUserId: 'feedface',
    });
    expect(env.DB.state.users.some((row) => row.id === 'feedface')).toBe(false);
    expect(env.DB.state.profiles.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.favorites.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.aiFolders.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.aiImages.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.aiGenerationLog.some((row) => row.user_id === 'feedface')).toBe(false);
    expect(env.DB.state.userActivityLog.some((row) => row.user_id === 'feedface')).toBe(true);
    expect(env.DB.state.r2CleanupQueue.map((row) => row.r2_key)).toEqual([
      'users/feedface/folders/projects/ab12cd34.png',
    ]);
    expect(env.USER_IMAGES.objects.has('users/feedface/folders/projects/ab12cd34.png')).toBe(true);
    expect(env.PRIVATE_MEDIA.objects.has('avatars/feedface')).toBe(false);
    expect(env.DB.state.adminAuditLog.at(-1).action).toBe('delete_user');
  });
});
