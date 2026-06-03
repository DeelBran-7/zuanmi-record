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
