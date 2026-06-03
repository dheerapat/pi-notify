/**
 * pi-notify — Multi‑platform turn notifications for pi
 *
 * Sends webhook notifications when the agent starts/ends chat turns.
 * Configure via ~/.pi/agent/notify.json or environment variables.
 *
 * Supported platforms: Discord (webhook), ntfy.sh
 * Future: Slack, Telegram, Pushover, etc.
 *
 * Quick start (Discord):
 *   1. export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
 *   2. Launch pi
 *
 * Quick start (ntfy.sh):
 *   1. export NTFY_URL="https://ntfy.sh/mytopic"
 *   2. Launch pi
 *
 *   Or:
 *   1. /pi-notify-init  → creates default config file
 *   2. Edit ~/.pi/agent/notify.json
 *   3. /reload in pi
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { loadConfig, applyEnvOverrides, initConfigFile, writeConfig, DEFAULT_CONFIG, CONFIG_PATH } from "./config";
import type { IncludeConfig, NotifyConfig } from "./config";
import { isDiscordConfigured, sendDiscord, DISCORD_BLURPLE } from "./platforms/discord";
import type { DiscordEmbedField, DiscordEmbed } from "./platforms/discord";
import { isNtfyConfigured, sendNtfy } from "./platforms/ntfy";
import type { NtfyPayload } from "./platforms/ntfy";

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

function extractLastAgentMessage(messages: Array<{ role: string; content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
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
    const lastMsg = extractLastAgentMessage(ctx.messages);
    if (lastMsg) {
      fields.push({ name: "Last response", value: elide(lastMsg, 256), inline: false });
    }
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
// ntfy.sh helpers
// ---------------------------------------------------------------------------

/** Build an ntfy payload from an embed context (text-based summary). */
function buildNtfyPayload(ctx: EmbedContext): NtfyPayload {
  const prompt = extractFirstUserPrompt(ctx.messages as Array<{ role: string; content?: unknown }>);
  const lines: string[] = [];

  if (ctx.include.prompt && prompt) {
    lines.push(`Prompt: ${elide(prompt, 200)}`);
  }

  if (ctx.include.message_counts) {
    const counts = countMessages(ctx.messages as Array<{ role: string }>);
    const parts: string[] = [];
    if (counts.user) parts.push(`user: ${counts.user}`);
    if (counts.assistant) parts.push(`assistant: ${counts.assistant}`);
    if (counts.toolResult) parts.push(`tools: ${counts.toolResult}`);
    if (parts.length) lines.push(`Messages: ${parts.join(" · ")}`);
  }

  if (ctx.include.model) {
    lines.push(`Model: ${ctx.modelName}`);
  }

  if (ctx.include.token_usage) {
    const usage = extractTokenUsage(ctx.messages as Array<{ usage?: { input?: number; output?: number; cacheRead?: number } }>);
    if (usage) {
      const parts: string[] = [];
      if (usage.input) parts.push(`in: ${usage.input.toLocaleString()}`);
      if (usage.output) parts.push(`out: ${usage.output.toLocaleString()}`);
      if (usage.cacheRead) parts.push(`cache: ${usage.cacheRead.toLocaleString()}`);
      lines.push(`Tokens: ${parts.join(" · ")}`);
    }
  }

  if (ctx.include.tools_detail) {
    const tools = summarizeToolCalls(ctx.messages as Array<{ role: string; toolName?: string }>);
    if (tools.length > 0) {
      const top = tools.slice(0, 6);
      const extra = tools.length > 6 ? ` (+${tools.length - 6} more)` : "";
      lines.push(`Tools: ${top.map((t) => `${t.name}×${t.count}`).join(", ")}${extra}`);
    }
  }

  if (ctx.include.session) {
    const lastMsg = extractLastAgentMessage(ctx.messages);
    if (lastMsg) {
      lines.push(`Last response: ${elide(lastMsg, 200)}`);
    }
  }

  return {
    message: lines.join("\n") || "(no details)",
    title: ctx.title,
    tags: ["robot"],
  };
}

async function notifyNtfy(webhookUrl: string, payload: NtfyPayload): Promise<void> {
  await sendNtfy(webhookUrl, payload);
}

/** Build a minimal ntfy payload (for agent_start). */
function buildNtfyMinimalPayload(ctx: EmbedContext): NtfyPayload {
  const lines: string[] = [
    `Model: ${ctx.modelName}`,
    `Session: ${ctx.sessionName}`,
    `cwd: ${ctx.cwd}`,
  ];
  return {
    message: lines.join("\n"),
    title: ctx.title,
    tags: ["robot"],
  };
}

// ---------------------------------------------------------------------------
// Interactive setup wizard (shared by /notify-init and /pi-notify-init)
// ---------------------------------------------------------------------------

async function runInitWizard(ctx: {
  ui: {
    select: (title: string, options: string[]) => Promise<string | undefined>;
    input: (prompt: string, placeholder?: string) => Promise<string | undefined>;
    confirm: (title: string, message: string) => Promise<boolean>;
    notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
  };
}): Promise<void> {
  // a. If config already exists, ask before overwriting
  if (existsSync(CONFIG_PATH)) {
    const ok = await ctx.ui.confirm(
      "Config exists",
      `Config already exists at ${CONFIG_PATH}. Overwrite with a fresh setup?`
    );
    if (!ok) {
      ctx.ui.notify("Config left unchanged", "warning");
      return;
    }
  }

  // b. Platform selection
  const platformChoices = [
    { label: "Discord (webhook)", value: "discord" },
    { label: "ntfy.sh", value: "ntfy" },
    // Future: { label: "Slack (webhook)", value: "slack" },
    // Future: { label: "Telegram (bot token)", value: "telegram" },
  ] as const;

  const selectedLabel = await ctx.ui.select(
    "Which platform do you want to configure?",
    platformChoices.map((p) => p.label)
  );

  if (!selectedLabel) {
    ctx.ui.notify("Setup cancelled", "info");
    return;
  }

  const selected = platformChoices.find((p) => p.label === selectedLabel)!;

  // c. Webhook URL input
  const placeholder =
    selected.value === "discord"
      ? "https://discord.com/api/webhooks/..."
      : selected.value === "ntfy"
        ? "https://ntfy.sh/mytopic"
        : "https://hooks.example.com/webhook/...";

  const webhookUrl = await ctx.ui.input(
    `Enter your ${selected.value} webhook URL:`,
    placeholder
  );

  if (!webhookUrl) {
    ctx.ui.notify("Setup cancelled", "info");
    return;
  }

  // d. Build and save config
  const config = {
    platforms: {
      [selected.value]: {
        webhook_url: webhookUrl,
        enabled: true,
      },
    },
    triggers: { ...DEFAULT_CONFIG.triggers },
    include: { ...DEFAULT_CONFIG.include },
  } as NotifyConfig;

  writeConfig(config);
  ctx.ui.notify(
    `\u2705 Config saved to ${CONFIG_PATH} \u2014 run /reload to activate`,
    "info"
  );
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
  const useNtfy = isNtfyConfigured(fileConfig.platforms.ntfy);
  const anyPlatform = useDiscord || useNtfy;

  if (!anyPlatform) {
    const initMsg = fromFile
      ? `No enabled platforms in ${CONFIG_PATH}. ` +
        "Set a platform's `enabled: true` and provide a webhook URL."
      : "No platforms configured. Set DISCORD_WEBHOOK_URL or run /notify to create a config file.";

    console.warn(`[pi-notify] ${initMsg}`);
  }

  // 4. Register interactive setup command
  pi.registerCommand("notify", {
    description: "Interactively configure pi-notify — pick a platform and enter webhook URL",
    handler: async (_args, ctx) => runInitWizard(ctx),
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
  if (fileConfig.triggers.agent_end) {
    if (useDiscord) {
      pi.on("agent_end", async (event, extCtx) => {
        const embed = buildDiscordEmbed(ctxFromAgentEnd(event, extCtx, "Pi — Turn finished", DISCORD_BLURPLE));
        await notifyDiscord(fileConfig.platforms.discord!.webhook_url, embed);
      });
    }
    if (useNtfy) {
      pi.on("agent_end", async (event, extCtx) => {
        const ctx = ctxFromAgentEnd(event, extCtx, "Pi — Turn finished", 0);
        await notifyNtfy(fileConfig.platforms.ntfy!.webhook_url, buildNtfyPayload(ctx));
      });
    }
  }

  // agent_start — fires when agent begins processing (no messages yet)
  if (fileConfig.triggers.agent_start) {
    if (useDiscord) {
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
    if (useNtfy) {
      pi.on("agent_start", async (_event, extCtx) => {
        const meta = resolveMeta(extCtx);
        const ctx: EmbedContext = {
          messages: [],
          ...meta,
          include: fileConfig.include,
          title: "Pi — Processing started",
          color: 0,
        };
        await notifyNtfy(fileConfig.platforms.ntfy!.webhook_url, buildNtfyMinimalPayload(ctx));
      });
    }
  }

  // turn_end — fires after each individual turn within the agent loop
  if (fileConfig.triggers.turn_end) {
    if (useDiscord) {
      pi.on("turn_end", async (event, extCtx) => {
        const embed = buildDiscordEmbed(ctxFromTurnEnd(event, extCtx, DISCORD_BLURPLE));
        await notifyDiscord(fileConfig.platforms.discord!.webhook_url, embed);
      });
    }
    if (useNtfy) {
      pi.on("turn_end", async (event, extCtx) => {
        const ctx = ctxFromTurnEnd(event, extCtx, 0);
        await notifyNtfy(fileConfig.platforms.ntfy!.webhook_url, buildNtfyPayload(ctx));
      });
    }
  }
}
