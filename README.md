# Retell Voice Plugin for OpenClaw

Talk to your OpenClaw AI assistant by phone — with full tool access.

This plugin integrates [Retell AI](https://www.retellai.com/) with OpenClaw, enabling voice conversations that have the same capabilities as your text chats. Ask your assistant to check your calendar, send messages, look things up, or anything else it can do via text.

## How It Works

1. **Retell handles telephony** — They provide the phone number, STT (speech-to-text), and TTS (text-to-speech)
2. **This plugin bridges to OpenClaw** — Via Retell's Custom LLM WebSocket protocol
3. **Your agent responds with tools** — Same agent, same memory, same capabilities as text

```
Phone Call → Retell (STT) → This Plugin → OpenClaw Agent → This Plugin → Retell (TTS) → Phone Call
```

## Quick Start

### 1. Install the Plugin

```bash
# From npm (when published)
openclaw plugins install @openclaw/retell-voice

# Or link locally for development
openclaw plugins install -l ./extensions/retell-voice
```

### 2. Configure

Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json5
{
  "plugins": {
    "entries": {
      "retell-voice": {
        "enabled": true,
        "config": {
          "allowFrom": ["+15551234567", "+15559876543"],  // Allowed callers
          "greeting": "Hey! What's up?",
          "websocket": {
            "port": 8765
          }
        }
      }
    }
  }
}
```

### 3. Expose the WebSocket Endpoint

Retell needs to reach your server. Options:

**Tailscale Funnel (recommended):**
```bash
tailscale funnel 8765
```

**ngrok:**
```bash
ngrok http 8765
```

### 4. Set Up Retell

1. Sign up at [retellai.com](https://www.retellai.com/)
2. Create a new agent → Choose **Custom LLM**
3. Set the LLM WebSocket URL:
   ```
   wss://your-hostname.ts.net/llm-websocket/
   ```
4. Get a phone number and assign it to your agent

### 5. Call Your Number!

That's it. Call the number and start talking to your AI assistant.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `apiKey` | string | - | Retell API key (optional, for call management) |
| `allowFrom` | string[] | `[]` | Allowed caller phone numbers (E.164 format). Empty = allow all |
| `greeting` | string | `"Hey! What's up?"` | What to say when answering |
| `websocket.port` | number | `8765` | WebSocket server port |
| `websocket.path` | string | `"/llm-websocket"` | WebSocket path prefix |
| `responseModel` | string | - | Model override for voice responses |
| `responseTimeoutMs` | number | `30000` | Response generation timeout |

## CLI Commands

```bash
# Check server status
openclaw retell status
```

## Security

- **Caller filtering**: Only numbers in `allowFrom` can use the service
- **Phone number format**: Use E.164 format (`+15551234567`)
- **Session isolation**: Each caller gets their own session based on phone number
- **No credentials exposed**: Retell handles telephony; your OpenClaw stays private

## Limitations

- **Retell's TTS/STT**: Voice quality depends on Retell's providers
- **Latency**: Expect 1-3 seconds response time (STT + LLM + TTS)
- **Cost**: Retell charges per minute (~$0.10-0.16/min depending on plan)

## Development

```bash
# Clone and link
cd ~/clawd/extensions/retell-voice
openclaw plugins install -l .

# Restart gateway to load changes
openclaw gateway restart

# Check logs
openclaw retell status
```

## License

MIT
