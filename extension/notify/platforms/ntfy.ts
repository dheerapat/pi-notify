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

/**
 * Send a notification via ntfy.sh.
 *
 * Uses the simple text/plain POST when there's only a message body,
 * or HTTP headers for richer payloads (title, tags, priority).
 * Header values are sanitized to ASCII to avoid ByteString errors.
 */
export async function sendNtfy(
  webhookUrl: string,
  payload: NtfyPayload,
): Promise<boolean> {
  try {
    const headers: Record<string, string> = {};

    // If we only have a message, POST as plain text (simpler / no headers)
    if (!payload.title && !payload.tags && payload.priority === undefined) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: payload.message,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "(no body)");
        console.error(`[pi-notify] ntfy.sh ${res.status}: ${text}`);
        return false;
      }
      return true;
    }

    // Richer payload — send as plain text with ASCII-safe headers
    if (payload.title) headers["Title"] = sanitizeAscii(payload.title);
    if (payload.tags && payload.tags.length > 0) headers["Tags"] = payload.tags.join(",");
    if (payload.priority !== undefined) headers["Priority"] = String(payload.priority);

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { ...headers, "Content-Type": "text/plain" },
      body: payload.message,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.error(`[pi-notify] ntfy.sh ${res.status}: ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[pi-notify] ntfy.sh error:`, err);
    return false;
  }
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
