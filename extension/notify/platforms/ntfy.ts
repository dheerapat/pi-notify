/**
 * ntfy.sh notification platform adapter.
 *
 * ntfy lets you push notifications via simple HTTP POST.
 * See: https://ntfy.sh/docs/
 */

import type { NtfyConfig } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NtfyPayload {
  /** Main notification body (plain text) */
  message: string;
  /** Optional title */
  title?: string;
  /** Optional tags (emoji shortcodes, e.g. "partying_face", "warning") */
  tags?: string[];
  /** Priority: 1=min, 2=low, 3=default, 4=high, 5=urgent */
  priority?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize a string so it only contains ASCII printable characters
 * (HTTP header values must be valid ByteString / ASCII).
 * Non-ASCII characters are replaced with their closest ASCII equivalent.
 */
function sanitizeAscii(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, (c) => {
    switch (c) {
      case "\u2013":
      case "\u2014":
        return "-"; // en/em dash → hyphen
      case "\u2018":
      case "\u2019":
        return "'"; // smart single quotes → apostrophe
      case "\u201C":
      case "\u201D":
        return '"'; // smart double quotes → quotation mark
      case "\u2026":
        return "..."; // ellipsis
      default:
        return " ";
    }
  }).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/** Timeout per attempt (ms). */
const ATTEMPT_TIMEOUT = 5_000;

/** Backoff delay before retry (ms). */
const BACKOFF_DELAY = 1_000;

/** Maximum number of attempts. */
const MAX_ATTEMPTS = 2;

/** Build the fetch init, signal, and headers for a given payload. */
function buildRequest(
  payload: NtfyPayload,
  signal: AbortSignal,
): { headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {};

  if (payload.title) headers["Title"] = sanitizeAscii(payload.title);
  if (payload.tags && payload.tags.length > 0) headers["Tags"] = payload.tags.join(",");
  if (payload.priority !== undefined) headers["Priority"] = String(payload.priority);

  return { headers, body: payload.message };
}

/**
 * Send a single fetch request and return true on 2xx.
 * Logs HTTP-level errors but does NOT catch — caller handles retry.
 */
async function attemptSend(
  webhookUrl: string,
  payload: NtfyPayload,
  attempt: number,
): Promise<boolean> {
  const signal = AbortSignal.timeout(ATTEMPT_TIMEOUT);
  const { headers, body } = buildRequest(payload, signal);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { ...headers, "Content-Type": "text/plain" },
    body,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.error(`[pi-notify] ntfy.sh attempt ${attempt}/${MAX_ATTEMPTS} — ${res.status}: ${text}`);
    return false;
  }

  return true;
}

/**
 * Send a notification via ntfy.sh with retry + backoff.
 *
 * - Timeout per attempt: 5s
 * - Backoff before retry: 1s
 * - Max attempts: 2
 *
 * Header values are sanitized to ASCII to avoid ByteString errors.
 */
export async function sendNtfy(
  webhookUrl: string,
  payload: NtfyPayload,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ok = await attemptSend(webhookUrl, payload, attempt);
      if (ok) return true;

      // HTTP error (non-2xx) on last attempt — give up
      if (attempt === MAX_ATTEMPTS) {
        console.error(`[pi-notify] ntfy.sh notification failed after ${MAX_ATTEMPTS} attempts`);
        return false;
      }
    } catch (err) {
      // Network / timeout error
      const msg = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_ATTEMPTS) {
        console.error(`[pi-notify] ntfy.sh notification failed after ${MAX_ATTEMPTS} attempts — ${msg}`);
        return false;
      }

      console.warn(`[pi-notify] ntfy.sh attempt ${attempt}/${MAX_ATTEMPTS} failed — ${msg}, retrying in ${BACKOFF_DELAY}ms…`);
    }

    // Backoff before next attempt
    await new Promise((r) => setTimeout(r, BACKOFF_DELAY));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Check whether an ntfy config is valid and usable.
 */
export function isNtfyConfigured(cfg?: NtfyConfig): cfg is NtfyConfig {
  if (!cfg || !cfg.enabled) return false;
  if (!cfg.webhook_url || typeof cfg.webhook_url !== "string") {
    console.warn("[pi-notify] ntfy is enabled but webhook_url is missing or invalid");
    return false;
  }
  if (!cfg.webhook_url.startsWith("https://") && !cfg.webhook_url.startsWith("http://")) {
    console.warn("[pi-notify] ntfy webhook_url should be a valid URL (e.g. https://ntfy.sh/mytopic)");
    return false;
  }
  return true;
}
