import test from 'node:test';
import assert from 'node:assert/strict';
import { getPasswordRecoveryInfo, getPublicSyncConfig, resolveSyncSettings, normalizeEmail } from './sync-config.js';

test('public sync config is active only when url and anon key are present', () => {
  assert.equal(getPublicSyncConfig({ supabaseUrl: '', anonKey: 'x' }).configured, false);
  assert.equal(getPublicSyncConfig({ supabaseUrl: 'https://demo.supabase.co', anonKey: 'ey.demo' }).configured, true);
});

test('resolved sync settings prefer public config and keep the saved email', () => {
  const saved = {
    supabaseUrl: 'https://old.supabase.co',
    anonKey: 'old-key',
    email: ' QIBY032@GMAIL.COM ',
  };
  const publicConfig = {
    supabaseUrl: 'https://new.supabase.co',
    anonKey: 'new-key',
  };

  const resolved = resolveSyncSettings(saved, publicConfig);

  assert.equal(resolved.supabaseUrl, 'https://new.supabase.co');
  assert.equal(resolved.anonKey, 'new-key');
  assert.equal(resolved.email, 'qiby032@gmail.com');
  assert.equal(resolved.usesPublicConfig, true);
});

test('resolved sync settings keep manual config when no public config exists', () => {
  const resolved = resolveSyncSettings({
    supabaseUrl: 'https://manual.supabase.co',
    anonKey: 'manual-key',
    email: 'friend@example.com',
  });

  assert.equal(resolved.supabaseUrl, 'https://manual.supabase.co');
  assert.equal(resolved.anonKey, 'manual-key');
  assert.equal(resolved.usesPublicConfig, false);
});

test('email normalization trims and lowercases input', () => {
  assert.equal(normalizeEmail(' QIBY032@GMAIL.COM '), 'qiby032@gmail.com');
  assert.equal(normalizeEmail(''), '');
});

test('password recovery info detects code based reset links', () => {
  const info = getPasswordRecoveryInfo('https://deelbran-7.github.io/zuanmi-record/?code=abc123');

  assert.equal(info.hasRecovery, true);
  assert.equal(info.code, 'abc123');
});

test('password recovery info detects token based reset links', () => {
  const info = getPasswordRecoveryInfo('https://deelbran-7.github.io/zuanmi-record/#access_token=at&refresh_token=rt&type=recovery');

  assert.equal(info.hasRecovery, true);
  assert.equal(info.type, 'recovery');
  assert.equal(info.accessToken, 'at');
  assert.equal(info.refreshToken, 'rt');
});
