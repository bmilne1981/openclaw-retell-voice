/**
 * Gateway WebSocket client for Retell Voice plugin.
 * Connects to the OpenClaw gateway and uses chat.send to run agent turns.
 * This is the stable public API that won't break with internal refactors.
 */

import { WebSocket } from "ws";
import crypto from "node:crypto";

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

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface PendingChat {
  resolve: (value: ChatResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  chunks: string[];
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private pendingRequests = new Map<string, PendingRequest>();
  private pendingChats = new Map<string, PendingChat>();
  private config: GatewayClientConfig;
  private logger: any;
  private reconnecting = false;

  constructor(config: GatewayClientConfig, logger: any) {
    this.config = config;
    this.logger = logger;
  }

  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    const host = this.config.host || "127.0.0.1";
    const url = `ws://${host}:${this.config.port}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        const connectTimeout = setTimeout(() => {
          reject(new Error("Gateway connection timeout"));
          this.ws?.close();
        }, 10000);

        this.ws.on("open", () => {
          this.logger.debug("[gateway-client] WebSocket connected, sending handshake");
        });

        this.ws.on("message", (data) => {
          this.handleMessage(data.toString(), connectTimeout, resolve, reject);
        });

        this.ws.on("error", (err) => {
          this.logger.error("[gateway-client] WebSocket error:", err);
          clearTimeout(connectTimeout);
          reject(err);
        });

        this.ws.on("close", () => {
          this.connected = false;
          this.logger.info("[gateway-client] WebSocket closed");
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  private handleMessage(
    data: string,
    connectTimeout: ReturnType<typeof setTimeout>,
    connectResolve?: (value: void) => void,
    connectReject?: (error: Error) => void
  ) {
    try {
      const msg = JSON.parse(data);
      
      // Debug: log all incoming messages
      if (msg.type === "event") {
        this.logger.debug(`[gateway-client] Event received: ${msg.event} payload=${JSON.stringify(msg.payload || {}).substring(0, 200)}`);
      }

      // Handle connect challenge
      if (msg.type === "event" && msg.event === "connect.challenge") {
        this.sendHandshake(msg.payload?.nonce);
        return;
      }

      // Handle connect response
      if (msg.type === "res" && msg.payload?.type === "hello-ok") {
        clearTimeout(connectTimeout);
        this.connected = true;
        this.logger.info("[gateway-client] Connected to gateway");
        
        // Subscribe to chat events after connecting
        this.subscribeToChat();
        
        connectResolve?.();
        return;
      }

      // Handle connect error
      if (msg.type === "res" && !msg.ok && connectReject) {
        clearTimeout(connectTimeout);
        connectReject(new Error(msg.error?.message || "Connection rejected"));
        return;
      }

      // Handle response to our requests
      if (msg.type === "res" && msg.id) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.id);
          if (msg.ok) {
            pending.resolve(msg.payload);
          } else {
            pending.reject(new Error(msg.error?.message || "Request failed"));
          }
        }
        return;
      }

      // Handle agent events (streaming response)
      if (msg.type === "event" && msg.event === "agent") {
        const payload = msg.payload || {};
        const runId = payload.runId;

        if (runId && this.pendingChats.has(runId)) {
          const chat = this.pendingChats.get(runId)!;

          // Collect text from assistant stream
          if (payload.stream === "assistant" && payload.data?.text) {
            // Use the full accumulated text, not delta
            chat.chunks = [payload.data.text];
          }

          // Handle lifecycle events for completion
          if (payload.stream === "lifecycle" && payload.data?.phase) {
            const phase = payload.data.phase;
            
            if (phase === "end" || phase === "done" || phase === "error" || phase === "aborted") {
              clearTimeout(chat.timeout);
              this.pendingChats.delete(runId);

              const text = chat.chunks.join("").trim();

              if (phase === "error") {
                chat.resolve({
                  text: text || "Sorry, something went wrong.",
                  error: true,
                });
              } else if (phase === "aborted") {
                chat.resolve({
                  text: text || "Response was interrupted.",
                  aborted: true,
                });
              } else {
                // "end" or "done" = success
                chat.resolve({
                  text: text,
                });
              }
            }
          }
        }
        return;
      }

    } catch (err) {
      this.logger.error("[gateway-client] Failed to parse message:", err);
    }
  }

  private sendHandshake(nonce?: string) {
    const connectParams: any = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: "gateway-client",  // Must be a known client ID
        version: "1.0.0",
        platform: "plugin",
        mode: "backend",  // Must be a known mode
      },
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.admin"],
      caps: [],
      commands: [],
      permissions: {},
      auth: {},
      locale: "en-US",
      userAgent: "retell-voice-plugin/1.0.0",
    };

    // Add auth if configured
    if (this.config.token) {
      connectParams.auth.token = this.config.token;
    }
    if (this.config.password) {
      connectParams.auth.password = this.config.password;
    }

    // For local connections without proper device auth, we need allowInsecureAuth on the gateway
    // or we need to implement device signing. For now, rely on allowInsecureAuth for local.

    this.send({
      type: "req",
      id: crypto.randomUUID(),
      method: "connect",
      params: connectParams,
    });
  }

  private send(msg: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private subscribeToChat() {
    // Note: chat.subscribe method doesn't exist in current gateway version
    // Events should flow automatically to connected clients
    this.logger.debug("[gateway-client] Ready to receive chat events");
  }

  private async request(method: string, params: any, timeoutMs = 5000): Promise<any> {
    if (!this.connected) {
      await this.connect();
    }

    const id = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      this.send({
        type: "req",
        id,
        method,
        params,
      });
    });
  }

  /**
   * Send a chat message and wait for the full response.
   * Uses chat.send which runs the agent with full tool access.
   */
  async chat(opts: {
    sessionKey: string;
    message: string;
    systemContext?: string;  // Prepended to the message for context
    timeoutMs?: number;
  }): Promise<ChatResponse> {
    if (!this.connected) {
      await this.connect();
    }

    const timeoutMs = opts.timeoutMs || 30000;
    const idempotencyKey = crypto.randomUUID();

    // Build the message - include system context as a prefix if provided
    let fullMessage = opts.message;
    if (opts.systemContext) {
      fullMessage = `[Context: ${opts.systemContext}]\n\n${opts.message}`;
    }

    // Send chat.send request
    const response = await this.request("chat.send", {
      sessionKey: opts.sessionKey,
      message: fullMessage,
      idempotencyKey,
    }, 5000);

    const runId = response?.runId;
    if (!runId) {
      throw new Error("No runId in chat.send response");
    }

    // Wait for chat events to complete
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingChats.delete(runId);
        resolve({
          text: "Sorry, I took too long. Can you try again?",
          aborted: true,
        });
      }, timeoutMs);

      this.pendingChats.set(runId, {
        resolve,
        reject,
        timeout,
        chunks: [],
      });
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}
