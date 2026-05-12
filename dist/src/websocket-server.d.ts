/**
 * WebSocket server for Retell AI Custom LLM protocol.
 * Handles incoming calls and routes to OpenClaw agent via Gateway WebSocket.
 *
 * This version uses the stable Gateway API instead of embedding the agent directly,
 * making it resilient to OpenClaw internal refactors.
 */
import { type RetellVoiceConfig } from "./config.js";
/**
 * Start the WebSocket server for Retell Custom LLM connections
 */
export declare function startWebSocketServer(opts: {
    config: RetellVoiceConfig;
    coreConfig: any;
    logger: any;
}): Promise<void>;
/**
 * Stop the WebSocket server
 */
export declare function stopWebSocketServer(): Promise<void>;
//# sourceMappingURL=websocket-server.d.ts.map