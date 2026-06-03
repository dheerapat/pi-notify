/**
 * Config types and loader for pi-notify.
 *
 * Config file: ~/.pi/agent/notify.json
 * Env vars override platform webhook URLs (e.g. DISCORD_WEBHOOK_URL).
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscordConfig {
  webhook_url: string;
  enabled: boolean;
}

export interface NtfyConfig {
  webhook_url: string;
  enabled: boolean;
}

export interface PlatformConfigs {
  discord?: DiscordConfig;
  ntfy?: NtfyConfig;
  // future: slack, telegram, etc.
}

export interface TriggerConfig {
  /** Fire when the agent finishes a full chat turn (idle). Default: true */
  agent_end: boolean;
  /** Fire when the agent starts processing. Default: false */
  agent_start: boolean;
  /** Fire after each individual turn. Default: false */
  turn_end: boolean;
}

export interface IncludeConfig {
  /** Show the user's first prompt. Default: true */
  prompt: boolean;
  /** Show counts of messages by role. Default: true */
  message_counts: boolean;
  /** Show the model name. Default: true */
  model: boolean;
  /** Show session name/path. Default: true */
  session: boolean;
  /** Show a breakdown of tools called. Default: false */
  tools_detail: boolean;
  /** Show token usage if available. Default: false */
  token_usage: boolean;
}

export interface NotifyConfig {
  platforms: PlatformConfigs;
  triggers: TriggerConfig;
  include: IncludeConfig;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_CONFIG: NotifyConfig = {
  platforms: {},
  triggers: {
    agent_end: true,
    agent_start: false,
    turn_end: false,
  },
  include: {
    prompt: true,
    message_counts: true,
    model: true,
    session: true,
    tools_detail: false,
    token_usage: false,
  },
};

export const CONFIG_DIR = join(homedir(), ".pi", "agent");
export const CONFIG_PATH = join(CONFIG_DIR, "notify.json");

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(overlay)) {
    const ov = (overlay as Record<string, unknown>)[key];
    const bv = out[key];
    if (ov !== undefined && bv !== undefined && typeof ov === "object" && typeof bv === "object" && !Array.isArray(ov) && !Array.isArray(bv)) {
      out[key] = deepMerge(bv as Record<string, unknown>, ov as Record<string, unknown>);
    } else if (ov !== undefined) {
      out[key] = ov;
    }
  }
  return out as T;
}

/**
 * Load config from disk, merged onto defaults.
 * Returns the merged config and whether a config file was found.
 */
export function loadConfig(): { config: NotifyConfig; fromFile: boolean } {
  let fromFile = false;

  if (!existsSync(CONFIG_PATH)) {
    return { config: { ...DEFAULT_CONFIG }, fromFile };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const overlay = JSON.parse(raw) as Partial<NotifyConfig>;
    fromFile = true;
    return { config: deepMerge(DEFAULT_CONFIG, overlay), fromFile };
  } catch (err) {
    console.warn(`[pi-notify] Failed to parse ${CONFIG_PATH}:`, err);
    return { config: { ...DEFAULT_CONFIG }, fromFile };
  }
}

/**
 * Apply env-var overrides to the config (mutates in place).
 *
 * DISCORD_WEBHOOK_URL → platforms.discord.webhook_url + enabled=true
 * NTFY_URL           → platforms.ntfy.webhook_url + enabled=true
 */
export function applyEnvOverrides(config: NotifyConfig): void {
  // Discord
  const discordUrl = process.env["DISCORD_WEBHOOK_URL"];
  if (discordUrl) {
    config.platforms.discord = {
      webhook_url: discordUrl,
      enabled: true,
    };
  }

  // ntfy.sh
  const ntfyUrl = process.env["NTFY_URL"];
  if (ntfyUrl) {
    config.platforms.ntfy = {
      webhook_url: ntfyUrl,
      enabled: true,
    };
  }
}

// ---------------------------------------------------------------------------
// CLI: --pi-notify-init
// ---------------------------------------------------------------------------

/**
 * Write the default config file if it doesn't exist.
 * Safe to call unconditionally — won't overwrite existing configs.
 */
export function initConfigFile(): boolean {
  if (existsSync(CONFIG_PATH)) return false;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
  console.log(`[pi-notify] Created default config at ${CONFIG_PATH}`);
  return true;
}

/**
 * Write a full config to disk, overwriting any existing file.
 */
export function writeConfig(config: NotifyConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Get available platforms (those that have configs, enabled or not).
 */
export function getAvailablePlatforms(): string[] {
  // Hard-coded list of supported platform keys
  return ["discord", "ntfy"];
}
