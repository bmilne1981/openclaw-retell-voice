/**
 * Retell Voice Plugin for OpenClaw
 *
 * Enables voice calls via Retell AI's Custom LLM WebSocket protocol.
 * Callers get full access to the OpenClaw agent with tools.
 *
 * Architecture:
 * - Retell sends voice → transcription → this plugin's WebSocket server
 * - Plugin connects to OpenClaw Gateway as a client (same as web UI)
 * - Uses chat.send to run agent turns with full tool access
 * - Response streams back → TTS → voice to caller
 *
 * This design uses the stable Gateway API, not internal OpenClaw modules,
 * making it resilient to version updates and internal refactors.
 */
import { startWebSocketServer, stopWebSocketServer } from "./src/websocket-server.js";
export const id = "retell-voice";
const configSchema = {
    parse(value) {
        const raw = value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
        return {
            enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
            apiKey: typeof raw.apiKey === "string" ? raw.apiKey : undefined,
            allowFrom: Array.isArray(raw.allowFrom) ? raw.allowFrom.filter(x => typeof x === "string") : [],
            greeting: typeof raw.greeting === "string" ? raw.greeting : "Hey! What's up?",
            websocket: {
                port: typeof raw.websocket?.port === "number" ? raw.websocket.port : 8765,
                path: typeof raw.websocket?.path === "string" ? raw.websocket.path : "/llm-websocket",
            },
            tailscale: {
                mode: raw.tailscale?.mode || "off",
                path: typeof raw.tailscale?.path === "string" ? raw.tailscale.path : undefined,
            },
            responseModel: typeof raw.responseModel === "string" ? raw.responseModel : undefined,
            responseTimeoutMs: typeof raw.responseTimeoutMs === "number" ? raw.responseTimeoutMs : 30000,
        };
    },
};
let serverRunning = false;
export default function register(api) {
    const config = configSchema.parse(api.pluginConfig);
    const coreConfig = api.config;
    if (!config.enabled) {
        api.logger.info("[retell-voice] Plugin disabled");
        return;
    }
    // Register background service for WebSocket server
    api.registerService({
        id: "retell-voice-server",
        async start() {
            if (serverRunning) {
                api.logger.warn("[retell-voice] Server already running");
                return;
            }
            try {
                await startWebSocketServer({
                    config,
                    coreConfig,
                    logger: api.logger,
                });
                serverRunning = true;
                api.logger.info(`[retell-voice] WebSocket server started on port ${config.websocket.port}`);
                api.logger.info(`[retell-voice] Endpoint: ws://localhost:${config.websocket.port}${config.websocket.path}/{call_id}`);
                if (config.allowFrom.length > 0) {
                    api.logger.info(`[retell-voice] Allowed callers: ${config.allowFrom.join(", ")}`);
                }
                else {
                    api.logger.warn("[retell-voice] No caller restrictions configured - anyone can call!");
                }
            }
            catch (err) {
                api.logger.error("[retell-voice] Failed to start server:", err);
                throw err;
            }
        },
        async stop() {
            if (!serverRunning)
                return;
            try {
                await stopWebSocketServer();
                serverRunning = false;
                api.logger.info("[retell-voice] WebSocket server stopped");
            }
            catch (err) {
                api.logger.error("[retell-voice] Error stopping server:", err);
            }
        },
    });
    // Register CLI commands
    api.registerCli(({ program }) => {
        const cmd = program
            .command("retell")
            .description("Retell Voice plugin commands");
        cmd
            .command("status")
            .description("Show Retell Voice server status")
            .action(() => {
            console.log(`Server running: ${serverRunning}`);
            console.log(`Port: ${config.websocket.port}`);
            console.log(`Path: ${config.websocket.path}`);
            console.log(`Allowed callers: ${config.allowFrom.length > 0 ? config.allowFrom.join(", ") : "(none - open)"}`);
        });
    }, { commands: ["retell"] });
    // Register RPC method for status checks
    api.registerGatewayMethod("retell.status", ({ respond }) => {
        respond(true, {
            running: serverRunning,
            port: config.websocket.port,
            path: config.websocket.path,
            allowFrom: config.allowFrom,
        });
    });
}
//# sourceMappingURL=index.js.map