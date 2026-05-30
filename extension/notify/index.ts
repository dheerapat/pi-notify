/**
 * pi-notify — Multi‑platform turn notifications for pi
 *
 * Sends webhook notifications when the agent starts/ends chat turns.
 * Configure via ~/.pi/agent/notify.json or environment variables.
 *
 * Supported platforms: Discord (webhook)
 * Future: Slack, Telegram, ntfy, Pushover, etc.
 *
 * Quick start:
 *   1. export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
 *   2. Launch pi
 *
 *   Or:
 *   1. /pi-notify-init  → creates default config file
 *   2. Edit ~/.pi/agent/notify.json
 *   3. /reload in pi
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, applyEnvOverrides, initConfigFile, CONFIG_PATH } from "./config";
import type { IncludeConfig } from "./config";
import { isDiscordConfigured, sendDiscord, DISCORD_BLURPLE } from "./platforms/discord";
import type { DiscordEmbedField, DiscordEmbed } from "./platforms/discord";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function elide(str: string, maxLen = 512): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}

function extractFirstUserPrompt(messages: Array<{ role: string; content?: unknown }>): string {
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    if (Array.isArray(msg.content)) {
      for (const block of msg.content as Array<{ type: string; text?: string }>) {
        if (block.type === "text" && block.text) return block.text.trim();
      }
    } else if (typeof msg.content === "string" && msg.content.trim()) {
      return msg.content.trim();
    }
  }
  return "";
}

interface MessageCounts {
  assistant: number;
  user: number;
  toolResult: number;
  system: number;
}

function countMessages(messages: Array<{ role: string }>): MessageCounts {
  const counts: MessageCounts = { assistant: 0, user: 0, toolResult: 0, system: 0 };
  for (const m of messages) {
    if (m.role in counts) counts[m.role as keyof MessageCounts]++;
  }
  return counts;
}

interface ToolCallInfo {
  name: string;
  count: number;
}

function summarizeToolCalls(messages: Array<{ role: string; toolName?: string }>): ToolCallInfo[] {
  const tally: Record<string, number> = {};
  for (const m of messages) {
    if (m.role === "toolResult" && m.toolName) {
      tally[m.toolName] = (tally[m.toolName] ?? 0) + 1;
    }
  }
  return Object.entries(tally)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function extractTokenUsage(messages: Array<{ usage?: { input?: number; output?: number; cacheRead?: number } }>): {
  input: number;
  output: number;
  cacheRead: number;
} | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  for (const m of messages) {
    if (m.usage) {
      input += m.usage.input ?? 0;
      output += m.usage.output ?? 0;
      cacheRead += m.usage.cacheRead ?? 0;
    }
  }
  if (input === 0 && output === 0) return null;
  return { input, output, cacheRead };
}

// ---------------------------------------------------------------------------
// Embed builder
// ---------------------------------------------------------------------------

interface EmbedContext {
  messages: Array<Record<string, unknown>>;
  modelName: string;
  sessionName: string;
  cwd: string;
  include: IncludeConfig;
  title: string;
  color: number;
}

function buildDiscordEmbed(ctx: EmbedContext): DiscordEmbed {
  const prompt = extractFirstUserPrompt(ctx.messages as Array<{ role: string; content?: unknown }>);

  const fields: DiscordEmbedField[] = [];

  if (ctx.include.message_counts) {
    const counts = countMessages(ctx.messages as Array<{ role: string }>);
    if (counts.user) fields.push({ name: "User", value: String(counts.user), inline: true });
    if (counts.assistant) fields.push({ name: "Assistant", value: String(counts.assistant), inline: true });
    if (counts.toolResult) fields.push({ name: "Tools", value: String(counts.toolResult), inline: true });
  }

  if (ctx.include.model) {
    fields.push({ name: "Model", value: ctx.modelName, inline: true });
  }

  if (ctx.include.tools_detail) {
    const tools = summarizeToolCalls(ctx.messages as Array<{ role: string; toolName?: string }>);
    if (tools.length > 0) {
      const top = tools.slice(0, 8);
      const extra = tools.length > 8 ? ` (+${tools.length - 8} more)` : "";
      fields.push({
        name: "Tools called",
        value: top.map((t) => `\`${t.name}\` ×${t.count}`).join(", ") + extra,
        inline: false,
      });
    }
  }

  if (ctx.include.token_usage) {
    const usage = extractTokenUsage(ctx.messages as Array<{ usage?: { input?: number; output?: number; cacheRead?: number } }>);
    if (usage) {
      const parts: string[] = [];
      if (usage.input) parts.push(`in: ${usage.input.toLocaleString()}`);
      if (usage.output) parts.push(`out: ${usage.output.toLocaleString()}`);
      if (usage.cacheRead) parts.push(`cache: ${usage.cacheRead.toLocaleString()}`);
      fields.push({ name: "Tokens", value: parts.join("  ·  "), inline: false });
    }
  }

  if (ctx.include.session) {
    fields.push({ name: "Session", value: ctx.sessionName, inline: false });
  }

  const description = ctx.include.prompt && prompt ? elide(prompt) : undefined;

  return {
    title: ctx.title,
    description,
    color: ctx.color,
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: `cwd: ${ctx.cwd}` },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Shared webhook call
// ---------------------------------------------------------------------------

const AVATAR_URL = "https://raw.githubusercontent.com/earendil-works/pi-mono/main/docs/pi-logo.png";

async function notifyDiscord(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  await sendDiscord(webhookUrl, {
    embeds: [embed],
    username: "pi-agent",
    avatar_url: AVATAR_URL,
  });
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // 1. Try to create config if missing (no-op if exists)
  initConfigFile();

  // 2. Load config
  const { config: fileConfig, fromFile } = loadConfig();
  applyEnvOverrides(fileConfig);

  // 3. Determine which platforms are active
  const useDiscord = isDiscordConfigured(fileConfig.platforms.discord);
  const anyPlatform = useDiscord /* || useSlack || ... */;

  if (!anyPlatform) {
    const initMsg = fromFile
      ? `No enabled platforms in ${CONFIG_PATH}. ` +
        "Set a platform's `enabled: true` and provide a webhook URL."
      : "No platforms configured. Set DISCORD_WEBHOOK_URL or run /pi-notify-init to create a config file.";

    console.warn(`[pi-notify] ${initMsg}`);
  }

  // 4. Register the /pi-notify-init command
  pi.registerCommand("pi-notify-init", {
    description: "Create or recreate the pi-notify config file",
    handler: async (_args, ctx) => {
      const created = initConfigFile();
      if (created) {
        ctx.ui.notify(`Created config at ${CONFIG_PATH} — edit it and /reload`, "info");
      } else {
        ctx.ui.notify(`Config file already exists at ${CONFIG_PATH}`, "warning");
      }
    },
  });

  // 5. Shared helpers to build embed contexts from each event shape

  /** Resolve model name, session name, cwd from the extension context. */
  const resolveMeta = (ctx: { model?: { provider: string; id: string } | null; cwd: string; sessionManager: { getSessionFile: () => string | null } }) => ({
    modelName: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown",
    sessionName: pi.getSessionName() ?? ctx.sessionManager.getSessionFile() ?? "ephemeral",
    cwd: ctx.cwd,
  });

  /** Build embed context from agent_end (has event.messages array). */
  const ctxFromAgentEnd = (
    event: { messages?: Array<Record<string, unknown>> },
    extCtx: { model?: { provider: string; id: string } | null; cwd: string; sessionManager: { getSessionFile: () => string | null } },
    title: string,
    color: number,
  ): EmbedContext => ({
    messages: event.messages ?? [],
    ...resolveMeta(extCtx),
    include: fileConfig.include,
    title,
    color,
  });

  /** Build embed context from turn_end (has event.turnIndex, event.message, event.toolResults). */
  const ctxFromTurnEnd = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    event: { turnIndex: number; message?: Record<string, any>; toolResults?: Array<Record<string, any>> },
    extCtx: { model?: { provider: string; id: string } | null; cwd: string; sessionManager: { getSessionFile: () => string | null } },
    color: number,
  ): EmbedContext => {
    const messages: Array<Record<string, unknown>> = [];
    if (event.message) messages.push(event.message);
    if (event.toolResults) messages.push(...event.toolResults);
    return {
      messages,
      ...resolveMeta(extCtx),
      include: fileConfig.include,
      title: `Pi — Turn ${event.turnIndex + 1} complete`,
      color,
    };
  };

  // 6. Register event handlers based on trigger config

  // agent_end — the primary trigger: fires when agent is idle after full turn
  if (fileConfig.triggers.agent_end && useDiscord) {
    pi.on("agent_end", async (event, extCtx) => {
      const embed = buildDiscordEmbed(ctxFromAgentEnd(event, extCtx, "Pi — Turn finished", DISCORD_BLURPLE));
      await notifyDiscord(fileConfig.platforms.discord!.webhook_url, embed);
    });
  }

  // agent_start — fires when agent begins processing (no messages yet)
  if (fileConfig.triggers.agent_start && useDiscord) {
    pi.on("agent_start", async (_event, extCtx) => {
      const meta = resolveMeta(extCtx);
      const embed: DiscordEmbed = {
        title: "Pi — Processing started",
        color: DISCORD_BLURPLE,
        fields: [
          { name: "Model", value: meta.modelName, inline: true },
          { name: "Session", value: meta.sessionName, inline: true },
        ],
        footer: { text: `cwd: ${meta.cwd}` },
        timestamp: new Date().toISOString(),
      };
      await notifyDiscord(fileConfig.platforms.discord!.webhook_url, embed);
    });
  }

  // turn_end — fires after each individual turn within the agent loop
  if (fileConfig.triggers.turn_end && useDiscord) {
    pi.on("turn_end", async (event, extCtx) => {
      const embed = buildDiscordEmbed(ctxFromTurnEnd(event, extCtx, DISCORD_BLURPLE));
      await notifyDiscord(fileConfig.platforms.discord!.webhook_url, embed);
    });
  }
}
