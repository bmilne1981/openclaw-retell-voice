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
export declare class GatewayClient {
    private config;
    private logger;
    private baseUrl;
    constructor(config: GatewayClientConfig, logger: any);
    /**
     * Verify the gateway is reachable (lightweight check).
     */
    connect(): Promise<void>;
    /**
     * Send a chat message via the HTTP Chat Completions endpoint.
     * This uses the OpenAI-compatible /v1/chat/completions API.
     */
    chat(opts: {
        sessionKey: string;
        message: string;
        systemContext?: string;
        timeoutMs?: number;
    }): Promise<ChatResponse>;
    disconnect(): void;
    isConnected(): boolean;
}
//# sourceMappingURL=gateway-client.d.ts.map