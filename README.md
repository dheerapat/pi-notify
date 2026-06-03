# pi-notify

**Multi-platform turn notifications for [pi](https://github.com/earendil-works/pi-mono)** — get pinged on Discord or [ntfy.sh](https://ntfy.sh) when the agent finishes a chat turn, so you can step away and come back when it's done.

- 🔔 Discord webhook embed with prompt, model, session, tool/token stats
- 📟 ntfy.sh push notifications (self-hosted or ntfy.sh cloud)
- 🧩 Configurable triggers: `agent_end`, `agent_start`, `turn_end`
- 🎛 Toggle what goes into the notification (prompt, counts, tools, tokens...)
- 🔌 Ready for Slack, Telegram, Pushover — add a platform adapter in one file

<img width="680" height="577" alt="screenshot-2026-06-03_17-30-21" src="https://github.com/user-attachments/assets/1ff5a56b-83b0-4219-ae51-3f039c9d608c" />


## Quick start

### Via env var (zero config)

**Discord:**
```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
pi
```

**ntfy.sh:**
```bash
export NTFY_URL="https://ntfy.sh/mytopic"
pi
```

### Via config file

Run `/notify` inside pi — an interactive wizard will let you pick a platform and enter your webhook URL:

```
/notify
```

This creates `~/.pi/agent/notify.json` with your settings. You can also edit the file directly — see the schema below. Then run `/reload`.

**Config schema:**

```json
{
  "platforms": {
    "discord": {
      "webhook_url": "https://discord.com/api/webhooks/...",
      "enabled": true
    },
    "ntfy": {
      "webhook_url": "https://ntfy.sh/mytopic",
      "enabled": true
    }
  },
  "triggers": {
    "agent_end": true,
    "agent_start": false,
    "turn_end": false
  },
  "include": {
    "prompt": true,
    "message_counts": true,
    "model": true,
    "session": true,
    "tools_detail": false,
    "token_usage": false
  }
}
```

Then `/reload`. You can enable **multiple platforms at once** — notifications will be sent to every enabled platform.

## Install

```bash
pi install git:github.com/dheerapat/pi-notify
```

Or clone and load locally:

```bash
git clone https://github.com/dheerapat/pi-notify ~/.pi/agent/extensions/pi-notify
```

Then `/reload` in pi.

## Triggers

| Trigger       | Fires when                                   |
| ------------- | -------------------------------------------- |
| `agent_end`   | Agent finishes a full turn, idle and waiting |
| `agent_start` | Agent begins processing (no messages yet)    |
| `turn_end`    | Each individual LLM→tools cycle              |

## Include options

| Option           | Shows                                       |
| ---------------- | ------------------------------------------- |
| `prompt`         | First user message (truncated to 512 chars) |
| `message_counts` | "User: 1 · Assistant: 3 · Tools: 5"         |
| `model`          | e.g. `anthropic/claude-sonnet-4-5`          |
| `session`        | Session name or file path                   |
| `tools_detail`   | `` `read` ×3, `bash` ×2 `` breakdown        |
| `token_usage`    | "in: 12.4K · out: 3.2K · cache: 8.1K"       |

## Adding a platform

1. Create `platforms/<name>.ts` implementing `send(webhookUrl, payload)` and a config validator
2. Add the config type to `config.ts` → `PlatformConfigs`
3. Wire up in `index.ts` next to the Discord blocks

PRs welcome!

## License

MIT
