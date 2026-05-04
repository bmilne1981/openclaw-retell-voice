/**
 * Gateway HTTP client for Retell Voice plugin.
 * Uses the OpenClaw Gateway's HTTP Chat Completions endpoint (/v1/chat/completions)
 * instead of WebSocket, which avoids scope/auth issues with the WS handshake.
 */

export interface GatewayClientConfig {
  port: number;
  host?: string;
  token?: string;
  password?: string;
}

export interface ChatResponse {
  text: string;
  error?: boolean;
  aborted?: boolean;
}

export class GatewayClient {
  private config: GatewayClientConfig;
  private logger: any;
  private baseUrl: string;

  constructor(config: GatewayClientConfig, logger: any) {
    this.config = config;
    this.logger = logger;
    const host = config.host || "127.0.0.1";
    this.baseUrl = `http://${host}:${config.port}`;
  }

  /**
   * Verify the gateway is reachable (lightweight check).
   */
  async connect(): Promise<void> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        this.logger.info("[gateway-client] Gateway reachable via HTTP");
      } else {
        this.logger.warn(`[gateway-client] Gateway health check returned ${res.status}`);
      }
    } catch (err: any) {
      this.logger.error("[gateway-client] Gateway not reachable:", err.message);
      throw err;
    }
  }

  /**
   * Send a chat message via the HTTP Chat Completions endpoint.
   * This uses the OpenAI-compatible /v1/chat/completions API.
   */
  async chat(opts: {
    sessionKey: string;
    message: string;
    systemContext?: string;
    timeoutMs?: number;
  }): Promise<ChatResponse> {
    const timeoutMs = opts.timeoutMs || 30000;

    const messages: Array<{ role: string; content: string }> = [];

    // Add system context if provided
    if (opts.systemContext) {
      messages.push({ role: "system", content: opts.systemContext });
    }

    // Add user message
    messages.push({ role: "user", content: opts.message });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add auth token if configured
    if (this.config.token) {
      headers["Authorization"] = `Bearer ${this.config.token}`;
    }

    const body = {
      messages,
      // Route to the right session
      session_key: opts.sessionKey,
    };

    try {
      this.logger.debug(`[gateway-client] POST ${this.baseUrl}/v1/chat/completions session=${opts.sessionKey}`);

      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => "unknown");
        this.logger.error(`[gateway-client] HTTP ${res.status}: ${errorText}`);
        throw new Error(`Gateway returned ${res.status}: ${errorText}`);
      }

      const data = await res.json() as any;

      // Extract text from OpenAI-compatible response
      const choice = data.choices?.[0];
      const text = choice?.message?.content || "";

      if (!text) {
        this.logger.warn("[gateway-client] Empty response from gateway");
        return { text: "Hmm, I'm not sure what to say. Can you try again?" };
      }

      return { text };
    } catch (err: any) {
      if (err.name === "TimeoutError" || err.name === "AbortError") {
        this.logger.error(`[gateway-client] Request timed out after ${timeoutMs}ms`);
        return {
          text: "Sorry, I took too long on that one. What were you asking?",
          aborted: true,
        };
      }
      throw err;
    }
  }

  disconnect() {
    // No persistent connection to close with HTTP
  }

  isConnected(): boolean {
    // HTTP is stateless — always "connected" if gateway is up
    return true;
  }
}
