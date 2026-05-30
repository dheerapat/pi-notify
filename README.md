# pi-notify

**Multi-platform turn notifications for [pi](https://github.com/earendil-works/pi-mono)** — get pinged on Discord when the agent finishes a chat turn, so you can step away and come back when it's done.

- 🔔 Discord webhook embed with prompt, model, session, tool/token stats
- 🧩 Configurable triggers: `agent_end`, `agent_start`, `turn_end`
- 🎛 Toggle what goes into the notification (prompt, counts, tools, tokens...)
- 🔌 Ready for Slack, Telegram, ntfy, Pushover — add a platform adapter in one file

## Quick start

### Via env var (zero config)

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
pi
```

### Via config file

Run `/pi-notify-init` inside pi, then edit `~/.pi/agent/notify.json`:

```json
{
  "platforms": {
    "discord": {
      "webhook_url": "https://discord.com/api/webhooks/...",
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

Then `/reload`.

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
