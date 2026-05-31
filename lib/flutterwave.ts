// Flutterwave v4 API helper
// Auth: OAuth 2.0 — client_credentials → access_token (10-min expiry)
// Sandbox base: https://developersandbox-api.flutterwave.com
// Prod base:    https://f4bexperience.flutterwave.com

const SANDBOX_BASE = "https://developersandbox-api.flutterwave.com";
const PROD_BASE = "https://f4bexperience.flutterwave.com";
const TOKEN_URL =
  "https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token";

export const FLW_BASE =
  process.env.NODE_ENV === "production" ? PROD_BASE : SANDBOX_BASE;

// Module-level token cache — valid within the same warm Node.js process instance
let _cachedToken = "";
let _tokenExpiresAt = 0;

export async function getFlwToken(): Promise<string> {
  // Refresh 1 minute early to avoid edge-of-expiry failures
  if (_cachedToken && Date.now() < _tokenExpiresAt - 60_000) {
    return _cachedToken;
  }

  const clientId = process.env.FLW_CLIENT_ID;
  const clientSecret = process.env.FLW_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "FLW_CLIENT_ID and FLW_CLIENT_SECRET must be set in .env.local"
    );
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `Flutterwave token request failed: ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();
  _cachedToken = data.access_token as string;
  _tokenExpiresAt = Date.now() + (data.expires_in as number) * 1000;
  return _cachedToken;
}

export async function flwFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  const token = await getFlwToken();
  return fetch(`${FLW_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
    cache: "no-store",
  });
}

// AES-GCM encryption for card details using Node.js webcrypto
// encryptionKey: base64-encoded key from Flutterwave dashboard
// nonce: exactly 12 characters (same nonce must be used for all fields in one transaction)
export async function encryptCardField(
  data: string,
  encryptionKey: string,
  nonce: string
): Promise<string> {
  if (nonce.length !== 12) {
    throw new Error("Nonce must be exactly 12 characters");
  }

  const { webcrypto } = await import("node:crypto");
  const subtle = webcrypto.subtle;

  const keyBytes = new Uint8Array(Buffer.from(encryptionKey, "base64"));
  const key = await subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  const iv = new TextEncoder().encode(nonce);
  const encrypted = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(data)
  );

  return Buffer.from(new Uint8Array(encrypted)).toString("base64");
}

// Generate a 12-character alphanumeric nonce
export function generateNonce(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}
