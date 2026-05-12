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
export declare const id = "retell-voice";
export default function register(api: any): void;
//# sourceMappingURL=index.d.ts.map