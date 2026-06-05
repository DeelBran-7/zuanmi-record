export function normalizeEmail(email = '') {
  return String(email).trim().toLowerCase();
}

export function getPublicSyncConfig(config = {}) {
  const supabaseUrl = String(config.supabaseUrl || '').trim();
  const anonKey = String(config.anonKey || '').trim();
  return {
    supabaseUrl,
    anonKey,
    configured: Boolean(supabaseUrl && anonKey),
  };
}

export function getBrowserPublicSyncConfig() {
  return getPublicSyncConfig(globalThis.window?.ZUANMI_SYNC_CONFIG || {});
}

export function resolveSyncSettings(saved = {}, publicConfig = {}) {
  const resolvedPublicConfig = getPublicSyncConfig(publicConfig);
  return {
    supabaseUrl: resolvedPublicConfig.configured ? resolvedPublicConfig.supabaseUrl : String(saved.supabaseUrl || '').trim(),
    anonKey: resolvedPublicConfig.configured ? resolvedPublicConfig.anonKey : String(saved.anonKey || '').trim(),
    email: normalizeEmail(saved.email || ''),
    usesPublicConfig: resolvedPublicConfig.configured,
  };
}

export function getPasswordRecoveryInfo(rawUrl = '') {
  try {
    const url = new URL(String(rawUrl || ''), 'https://example.com');
    const hashText = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hashText);
    const type = hashParams.get('type') || url.searchParams.get('type') || '';
    const code = url.searchParams.get('code') || '';
    const accessToken = hashParams.get('access_token') || '';
    const refreshToken = hashParams.get('refresh_token') || '';
    const errorDescription = hashParams.get('error_description') || url.searchParams.get('error_description') || '';
    const hasRecovery = type === 'recovery' || Boolean(code) || Boolean(accessToken && refreshToken);
    return {
      hasRecovery,
      type,
      code,
      accessToken,
      refreshToken,
      errorDescription,
    };
  } catch {
    return {
      hasRecovery: false,
      type: '',
      code: '',
      accessToken: '',
      refreshToken: '',
      errorDescription: '',
    };
  }
}
