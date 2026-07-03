/**
 * AES-GCM encryption for system credentials stored in KV.
 *
 * Set CREDENTIALS_KEY to a base64-encoded 32-byte key:
 *   openssl rand -base64 32 | wrangler secret put CREDENTIALS_KEY
 *
 * When unset (dev), credentials are stored plaintext. Plaintext entries are
 * re-encrypted on next read once CREDENTIALS_KEY is configured.
 */

const ALGO = "AES-GCM";
const IV_LENGTH = 12;

function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(keyB64) {
  const raw = base64ToBytes(keyB64);
  if (raw.length !== 32) {
    throw new Error("CREDENTIALS_KEY must be 32 bytes (base64-encoded)");
  }
  return crypto.subtle.importKey("raw", raw, { name: ALGO }, false, ["encrypt", "decrypt"]);
}

export function isEncryptedCredentials(credentials) {
  return credentials?._encrypted === true;
}

export async function encryptCredentials(credentials, env) {
  if (!env.CREDENTIALS_KEY) return credentials;

  const key = await importKey(env.CREDENTIALS_KEY);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = await crypto.subtle.encrypt({ name: ALGO, iv }, key, plaintext);

  return {
    _encrypted: true,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptCredentials(stored, env) {
  if (!isEncryptedCredentials(stored)) return stored;

  if (!env.CREDENTIALS_KEY) {
    throw new Error("CREDENTIALS_KEY required to decrypt stored credentials");
  }

  const key = await importKey(env.CREDENTIALS_KEY);
  const iv = base64ToBytes(stored.iv);
  const data = base64ToBytes(stored.data);
  const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv }, key, data);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function saveSystemConfig(env, systemConfig) {
  const toStore = {
    ...systemConfig,
    credentials: await encryptCredentials(systemConfig.credentials, env),
  };
  await env.SYSTEMS.put(`system:${systemConfig.id}`, JSON.stringify(toStore));
}

/** Load system config from KV, decrypt credentials, migrate plaintext if needed. */
export async function loadSystemConfig(env, id) {
  const raw = await env.SYSTEMS.get(`system:${id}`, "json");
  if (!raw) return null;

  const wasPlaintext = raw.credentials && !isEncryptedCredentials(raw.credentials);
  raw.credentials = await decryptCredentials(raw.credentials, env);

  if (wasPlaintext && env.CREDENTIALS_KEY) {
    await saveSystemConfig(env, raw);
  }

  return raw;
}
