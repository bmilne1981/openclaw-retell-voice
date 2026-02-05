# Retell Voice Plugin for OpenClaw

Talk to your OpenClaw AI assistant by phone — with full tool access.

This plugin integrates [Retell AI](https://www.retellai.com/) with OpenClaw, enabling voice conversations that have the same capabilities as your text chats. Ask your assistant to check your calendar, send messages, control your smart home, or anything else it can do via text.

## How It Works

1. **Retell handles telephony** — They provide the phone number, STT (speech-to-text), and TTS (text-to-speech)
2. **This plugin bridges to OpenClaw** — Via Retell's Custom LLM WebSocket protocol
3. **Your agent responds with tools** — Same agent, same memory, same capabilities as text

```
Phone Call → Retell (STT) → This Plugin → OpenClaw Agent → This Plugin → Retell (TTS) → Phone
```

The plugin connects to the OpenClaw Gateway WebSocket API internally, using the stable public `chat.send` interface. This means it won't break when OpenClaw internals change.

## Installation

```bash
# From npm
npm install openclaw-retell-voice

# Then add to OpenClaw
openclaw plugins install openclaw-retell-voice
```

Or install directly:
```bash
openclaw plugins install openclaw-retell-voice
```

## Configuration

Add to your OpenClaw config (`~/.openclaw/openclaw.json`):

```json
{
  "plugins": {
    "entries": {
      "retell-voice": {
        "enabled": true,
        "config": {
          "allowFrom": ["+15551234567", "+15559876543"],
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

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the plugin |
| `allowFrom` | string[] | `[]` | Allowed caller phone numbers (E.164 format). Empty = allow all |
| `greeting` | string | `"Hey! What's up?"` | What the agent says when answering |
| `websocket.port` | number | `8765` | WebSocket server port |
| `websocket.path` | string | `"/llm-websocket"` | WebSocket path prefix |
| `responseTimeoutMs` | number | `30000` | Response generation timeout |

## Retell Setup

### 1. Expose the WebSocket Endpoint

Retell needs to reach your plugin's WebSocket server from the internet.

**Tailscale Funnel (recommended):**
```bash
tailscale serve --bg --set-path=/llm-websocket http://localhost:8765
tailscale funnel --bg 443
```

**ngrok:**
```bash
ngrok http 8765
```

### 2. Configure Retell

1. Sign up at [retellai.com](https://www.retellai.com/)
2. Create a new agent → Choose **Custom LLM**
3. Set the LLM WebSocket URL:
   ```
   wss://your-hostname.ts.net/llm-websocket/
   ```
   (Include the trailing slash!)
4. Get a phone number and assign it to your agent

### 3. Add Allowed Callers

Update your config with the phone numbers that should be able to call:

```json
"allowFrom": ["+15551234567"]
```

Use E.164 format (country code + number, no spaces or dashes).

### 4. Restart OpenClaw

```bash
openclaw gateway restart
```

### 5. Call Your Number!

That's it. Call the Retell number and talk to your AI assistant.

## Architecture

The plugin:

1. **Starts a WebSocket server** on the configured port
2. **Receives Retell events** (call start, user speech, etc.)
3. **Connects to OpenClaw Gateway** as an operator client
4. **Uses `chat.send`** to run agent turns with full tool access
5. **Streams responses back** to Retell for TTS

Each caller gets their own session (keyed by phone number), so conversation history persists across calls.

## Security

- **Caller allowlist**: Only numbers in `allowFrom` can use the service
- **Session isolation**: Each phone number gets a separate session
- **Local WebSocket**: The Retell→Plugin connection requires exposing a port, but Plugin→OpenClaw stays local
- **No credentials in transit**: Retell handles telephony; your OpenClaw API keys stay on your machine

## Costs

- **Retell**: ~$0.10-0.16/min depending on plan
- **OpenClaw/Claude**: Normal token costs for agent responses
- **Latency**: Expect ~3-5 seconds for responses (STT + LLM + TTS)

## Troubleshooting

**Call connects but no response:**
- Check `openclaw gateway restart` to reload the plugin
- Verify WebSocket server is running: `curl http://localhost:8765/`
- Check logs: `tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep retell`

**"Unauthorized" in logs:**
- Add the caller's phone number to `allowFrom` (E.164 format)

**Webhook URL not connecting:**
- Make sure Tailscale Funnel or ngrok is running
- URL should end with `/llm-websocket/` (trailing slash matters for some Retell configs)

## Development

```bash
# Clone the repo
git clone https://github.com/bmilne1981/openclaw-retell-voice.git
cd openclaw-retell-voice

# Link for local development
openclaw plugins install -l .

# Make changes, then restart
openclaw gateway restart

# Watch logs
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | grep retell
```

## License

MIT

## Credits

Built for [OpenClaw](https://github.com/openclaw/openclaw) using the [Retell AI](https://www.retellai.com/) platform.
