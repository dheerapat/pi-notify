/**
 * Discord webhook platform adapter.
 */

import type { DiscordConfig } from "../config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  fields?: DiscordEmbedField[];
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DISCORD_BLURPLE = 0x5865f2;
export const DISCORD_SUCCESS = 0x57f287; // green
export const DISCORD_WARNING = 0xfee75c; // yellow
export const DISCORD_ERROR = 0xed4245;   // red

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

/** Timeout per attempt (ms). */
const ATTEMPT_TIMEOUT = 5_000;

/** Backoff delay before retry (ms). */
const BACKOFF_DELAY = 1_000;

/** Maximum number of attempts. */
const MAX_ATTEMPTS = 2;

/**
 * Send a single Discord webhook request and return true on 2xx.
 * Logs HTTP-level errors but does NOT catch — caller handles retry.
 */
async function attemptSendDiscord(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
  attempt: number,
): Promise<boolean> {
  const signal = AbortSignal.timeout(ATTEMPT_TIMEOUT);

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    console.error(`[pi-notify] Discord attempt ${attempt}/${MAX_ATTEMPTS} — ${res.status}: ${text}`);
    return false;
  }

  return true;
}

/**
 * Send a Discord webhook notification with retry + backoff.
 *
 * - Timeout per attempt: 5s
 * - Backoff before retry: 1s
 * - Max attempts: 2
 */
export async function sendDiscord(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ok = await attemptSendDiscord(webhookUrl, payload, attempt);
      if (ok) return true;

      if (attempt === MAX_ATTEMPTS) {
        console.error(`[pi-notify] Discord webhook failed after ${MAX_ATTEMPTS} attempts`);
        return false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (attempt === MAX_ATTEMPTS) {
        console.error(`[pi-notify] Discord webhook failed after ${MAX_ATTEMPTS} attempts — ${msg}`);
        return false;
      }

      console.warn(`[pi-notify] Discord attempt ${attempt}/${MAX_ATTEMPTS} failed — ${msg}, retrying in ${BACKOFF_DELAY}ms…`);
    }

    await new Promise((r) => setTimeout(r, BACKOFF_DELAY));
  }

  return false;
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

/**
 * Check whether a Discord config is valid and usable.
 */
export function isDiscordConfigured(cfg?: DiscordConfig): cfg is DiscordConfig {
  if (!cfg || !cfg.enabled) return false;
  if (!cfg.webhook_url || typeof cfg.webhook_url !== "string") {
    console.warn("[pi-notify] Discord is enabled but webhook_url is missing or invalid");
    return false;
  }
  if (!cfg.webhook_url.startsWith("https://discord.com/api/webhooks/")) {
    console.warn("[pi-notify] Discord webhook_url doesn't look like a Discord webhook URL");
    return false;
  }
  return true;
}
