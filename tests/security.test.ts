import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAppServer,
  isAllowedLocalOrigin,
  validateAndSanitizePricingUpdate,
} from '../server/index.ts';
import { escapeCsvCell } from '../src/utils/export.ts';
import { escapeHtml, sanitizeCssColor } from '../src/utils/sanitize.ts';

describe('XSS & Export Sanitization', () => {
  test('escapeHtml neutralizes HTML/script payloads', () => {
    const xss = `<img src=x onerror="alert('xss')">&\`test\``;
    const escaped = escapeHtml(xss);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).not.toContain('"');
    expect(escaped).not.toContain("'");
    expect(escaped).not.toContain('`');
    expect(escaped).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;&#96;test&#96;',
    );
  });

  test('sanitizeCssColor permits only safe hex and rgb/rgba values', () => {
    expect(sanitizeCssColor('#34d399')).toBe('#34d399');
    expect(sanitizeCssColor('#fff')).toBe('#fff');
    expect(sanitizeCssColor('rgba(99, 102, 241, 0.5)')).toBe('rgba(99, 102, 241, 0.5)');
    expect(sanitizeCssColor('red; background:url(javascript:alert(1))')).toBe('#6366f1');
    expect(sanitizeCssColor('expression(alert(1))', '#000000')).toBe('#000000');
  });

  test('escapeCsvCell neutralizes spreadsheet formula injection', () => {
    expect(escapeCsvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`);
    expect(escapeCsvCell('+1+2')).toBe("'+1+2");
    expect(escapeCsvCell('-2+3')).toBe("'-2+3");
    expect(escapeCsvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(escapeCsvCell('Normal Title')).toBe('Normal Title');
  });
});

describe('Backend Security Hardening', () => {
  const tempDirs: string[] = [];
  const runningServers: { stop: () => void }[] = [];

  afterEach(() => {
    while (runningServers.length > 0) {
      runningServers.pop()?.stop();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempTestServer() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sec-test-'));
    tempDirs.push(tmp);
    const dataDir = path.join(tmp, 'antigravity');
    const distDir = path.join(tmp, 'dist');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>ok</body></html>');

    const app = createAppServer({
      port: 0,
      hostname: '127.0.0.1',
      dataDir,
      overridesPath: path.join(tmp, 'overrides.json'),
      distDir,
      enableWatcher: false,
    });
    runningServers.push(app);
    return { app, tmp, distDir, baseUrl: `http://127.0.0.1:${app.server.port}` };
  }

  test('allows only localhost/127.0.0.1 origins', () => {
    expect(isAllowedLocalOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedLocalOrigin('http://127.0.0.1:3001')).toBe(true);
    expect(isAllowedLocalOrigin('https://evil.example.com')).toBe(false);
    expect(isAllowedLocalOrigin('http://localhost.evil.com')).toBe(false);
    expect(isAllowedLocalOrigin('null')).toBe(false);
  });

  test('blocks prototype-pollution keys and unsafe colors in pricing updates', () => {
    const protoPayload = JSON.parse('{"models":{"__proto__":{"inputPer1M":1,"cacheReadPer1M":0,"outputPer1M":1}}}');
    const res1 = validateAndSanitizePricingUpdate(protoPayload);
    expect(res1.ok).toBe(false);

    const overridePayload = JSON.parse('{"conversationModelOverrides":{"constructor":"gemini-2.5-pro"}}');
    const res2 = validateAndSanitizePricingUpdate(overridePayload);
    expect(res2.ok).toBe(false);

    const badColor = validateAndSanitizePricingUpdate({
      models: {
        'custom-model': {
          id: 'custom-model',
          label: 'Custom',
          provider: 'other',
          inputPer1M: 1,
          cacheReadPer1M: 0.1,
          outputPer1M: 2,
          color: 'red;background:url(evil)',
        },
      },
    });
    expect(badColor.ok).toBe(true);
    if (badColor.ok) {
      expect(badColor.overrides.models?.['custom-model'].color).toBe('#94a3b8');
    }
  });

  test('enforces localhost CORS, CSRF rejection, security headers, 413 cap, and malformed URI handling', async () => {
    const { baseUrl, tmp, distDir } = createTempTestServer();

    // 1. Non-localhost Origin does NOT receive Access-Control-Allow-Origin
    const resEvilGet = await fetch(`${baseUrl}/api/pricing`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(resEvilGet.status).toBe(200);
    expect(resEvilGet.headers.get('access-control-allow-origin')).toBeNull();
    expect(resEvilGet.headers.get('x-content-type-options')).toBe('nosniff');
    expect(resEvilGet.headers.get('x-frame-options')).toBe('DENY');

    // 2. Localhost Origin receives explicit reflected CORS origin
    const resLocalGet = await fetch(`${baseUrl}/api/pricing`, {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(resLocalGet.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

    // 3. Cross-origin PUT mutation rejected with 403 (CSRF protection)
    const resCsrf = await fetch(`${baseUrl}/api/pricing`, {
      method: 'PUT',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ monthlySubscriptionUsd: 999 }),
    });
    expect(resCsrf.status).toBe(403);

    // 4. Oversized JSON payload rejected with 413
    const hugeBody = JSON.stringify({ fallbackModelId: 'a'.repeat(300_000) });
    const resHuge = await fetch(`${baseUrl}/api/pricing`, {
      method: 'PUT',
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: hugeBody,
    });
    expect(resHuge.status).toBe(413);

    // 5. Malformed percent-encoded conversation ID returns 400 (not 500)
    const resBadUri = await fetch(`${baseUrl}/api/conversations/%E0%A4%A`);
    expect(resBadUri.status).toBe(400);

    // 6. HTML static response includes strict CSP without unsafe-inline in script-src
    const resHtml = await fetch(`${baseUrl}/`);
    expect(resHtml.status).toBe(200);
    const csp = resHtml.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");

    // 7. Symlink escaping dist/ is blocked and falls back to index.html (never serves outside file)
    const secretFile = path.join(tmp, 'secret.txt');
    fs.writeFileSync(secretFile, 'TOP_SECRET_VALUE');
    fs.symlinkSync(secretFile, path.join(distDir, 'leak.txt'));
    const resLeak = await fetch(`${baseUrl}/leak.txt`);
    const leakBody = await resLeak.text();
    expect(leakBody).not.toContain('TOP_SECRET_VALUE');
  });
});
