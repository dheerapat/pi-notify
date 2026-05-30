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

export async function sendDiscord(
  webhookUrl: string,
  payload: DiscordWebhookPayload,
): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "(no body)");
      console.error(`[pi-notify] Discord webhook ${res.status}: ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[pi-notify] Discord webhook error:`, err);
    return false;
  }
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
