/**
 * WebSocket server for Retell AI Custom LLM protocol.
 * Handles incoming calls and routes to OpenClaw agent via Gateway WebSocket.
 * 
 * This version uses the stable Gateway API instead of embedding the agent directly,
 * making it resilient to OpenClaw internal refactors.
 */

import crypto from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { GatewayClient, type GatewayClientConfig } from "./gateway-client.js";
import { isAllowedCaller, normalizePhone, type RetellVoiceConfig } from "./config.js";

interface CallSession {
  callId: string;
  fromNumber?: string;
  authorized: boolean;
  transcript: Array<{ role: "user" | "agent"; content: string }>;
  sessionKey: string;
}

interface ServerContext {
  config: RetellVoiceConfig;
  coreConfig: any;
  logger: any;
  wss: WebSocketServer | null;
  activeCalls: Map<string, CallSession>;
  gateway: GatewayClient;
}

let ctx: ServerContext | null = null;

/**
 * Start the WebSocket server for Retell Custom LLM connections
 */
export async function startWebSocketServer(opts: {
  config: RetellVoiceConfig;
  coreConfig: any;
  logger: any;
}): Promise<void> {
  if (ctx?.wss) {
    throw new Error("Server already running");
  }

  // Get gateway connection info from config or defaults
  const gatewayPort = opts.coreConfig?.gateway?.port || 18789;
  const gatewayToken = opts.coreConfig?.gateway?.auth?.token || process.env.OPENCLAW_GATEWAY_TOKEN;
  const gatewayPassword = opts.coreConfig?.gateway?.auth?.password || process.env.OPENCLAW_GATEWAY_PASSWORD;

  // Create gateway client
  const gatewayConfig: GatewayClientConfig = {
    port: gatewayPort,
    host: "127.0.0.1",
    token: gatewayToken,
    password: gatewayPassword,
  };

  const gateway = new GatewayClient(gatewayConfig, opts.logger);

  // Connect to gateway
  try {
    await gateway.connect();
    opts.logger.info("[retell-voice] Connected to OpenClaw gateway");
  } catch (err) {
    opts.logger.error("[retell-voice] Failed to connect to gateway:", err);
    throw err;
  }

  // Create WebSocket server for Retell connections
  const wss = new WebSocketServer({
    port: opts.config.websocket.port,
  });

  ctx = {
    config: opts.config,
    coreConfig: opts.coreConfig,
    logger: opts.logger,
    wss,
    activeCalls: new Map(),
    gateway,
  };

  wss.on("connection", handleConnection);
  wss.on("error", (err) => {
    opts.logger.error("[retell-voice] WebSocket server error:", err);
  });
}

/**
 * Stop the WebSocket server
 */
export async function stopWebSocketServer(): Promise<void> {
  if (!ctx?.wss) return;

  ctx.gateway.disconnect();

  return new Promise((resolve) => {
    ctx!.wss!.close(() => {
      ctx = null;
      resolve();
    });
  });
}

/**
 * Handle a new WebSocket connection from Retell
 */
function handleConnection(ws: WebSocket, req: any) {
  if (!ctx) return;

  // Extract call ID from path
  const pathParts = req.url?.split("/") || [];
  const callId = pathParts[pathParts.length - 1] || crypto.randomUUID();

  ctx.logger.info(`[retell-voice] 📞 New call: ${callId}`);

  // Create session
  const session: CallSession = {
    callId,
    fromNumber: undefined,
    authorized: false,
    transcript: [],
    sessionKey: `retell:${callId}`,
  };

  ctx.activeCalls.set(callId, session);

  // Send initial config
  ws.send(JSON.stringify({
    response_type: "config",
    config: {
      auto_reconnect: true,
      call_details: true,
    },
  }));

  // Handle messages
  ws.on("message", (data) => handleMessage(ws, session, data));
  ws.on("close", () => handleClose(session));
  ws.on("error", (err) => {
    ctx?.logger.error(`[retell-voice] WebSocket error for ${callId}:`, err);
  });
}

/**
 * Handle an incoming message from Retell
 */
async function handleMessage(ws: WebSocket, session: CallSession, data: RawData) {
  if (!ctx) return;

  try {
    const event = JSON.parse(data.toString());
    const interactionType = event.interaction_type;

    // Handle call details - verify caller
    if (interactionType === "call_details") {
      const call = event.call || {};
      const direction = call.direction || "inbound";
      const fromNumber = call.from_number;
      const toNumber = call.to_number;
      
      const numberToCheck = direction === "outbound" ? toNumber : fromNumber;
      const phoneForSession = direction === "outbound" ? toNumber : fromNumber;
      
      ctx.logger.info(`[retell-voice] 📱 Call: ${direction} | from: ${fromNumber} | to: ${toNumber}`);

      if (!isAllowedCaller(numberToCheck || "", ctx.config.allowFrom)) {
        ctx.logger.warn(`[retell-voice] 🚫 Unauthorized: ${numberToCheck}`);
        ws.send(JSON.stringify({
          response_type: "response",
          response_id: 0,
          content: "Sorry, this number is not authorized. Goodbye.",
          content_complete: true,
          end_call: true,
        }));
        return;
      }

      // Update session key based on phone
      session.fromNumber = phoneForSession;
      const normalizedPhone = normalizePhone(phoneForSession || session.callId);
      session.sessionKey = `retell:${normalizedPhone}`;
      session.authorized = true;

      ctx.logger.info(`[retell-voice] ✅ Authorized: ${phoneForSession} (${direction})`);

      // Send greeting
      ws.send(JSON.stringify({
        response_type: "response",
        response_id: 0,
        content: ctx.config.greeting,
        content_complete: true,
        end_call: false,
      }));
      return;
    }

    // Handle ping/pong
    if (interactionType === "ping_pong") {
      ws.send(JSON.stringify({
        response_type: "ping_pong",
        timestamp: event.timestamp,
      }));
      return;
    }

    // Handle response required
    if (interactionType === "response_required" || interactionType === "reminder_required") {
      if (!session.authorized && ctx.config.allowFrom.length > 0) {
        ws.send(JSON.stringify({
          response_type: "response",
          response_id: event.response_id,
          content: "One moment please...",
          content_complete: true,
          end_call: false,
        }));
        return;
      }

      const transcript = event.transcript || [];
      const userMessages = transcript.filter((t: any) => t.role === "user");
      const lastUserMessage = userMessages[userMessages.length - 1];
      
      if (!lastUserMessage?.content) {
        ws.send(JSON.stringify({
          response_type: "response",
          response_id: event.response_id,
          content: "I'm here! What can I help you with?",
          content_complete: true,
          end_call: false,
        }));
        return;
      }

      // Update session transcript
      session.transcript = transcript.slice(-10).map((t: any) => ({
        role: t.role === "agent" ? "agent" : "user",
        content: t.content || "",
      }));

      ctx.logger.info(`[retell-voice] 📝 User: ${lastUserMessage.content.substring(0, 50)}...`);

      // Generate response via Gateway
      try {
        const response = await generateAgentResponse(session, lastUserMessage.content);
        
        ctx.logger.info(`[retell-voice] 🤖 Response: ${response.substring(0, 50)}...`);

        const shouldEndCall = 
          response.toLowerCase().includes("goodbye") ||
          response.toLowerCase().includes("talk to you later") ||
          response.toLowerCase().includes("bye for now") ||
          response.toLowerCase().includes("have a good");

        ws.send(JSON.stringify({
          response_type: "response",
          response_id: event.response_id,
          content: response,
          content_complete: true,
          end_call: shouldEndCall,
        }));
      } catch (err) {
        ctx.logger.error("[retell-voice] Agent error:", err);
        ws.send(JSON.stringify({
          response_type: "response",
          response_id: event.response_id,
          content: "Sorry, I had a brief hiccup. Can you say that again?",
          content_complete: true,
          end_call: false,
        }));
      }
    }

  } catch (err) {
    ctx.logger.error("[retell-voice] Message parse error:", err);
  }
}

/**
 * Handle connection close
 */
function handleClose(session: CallSession) {
  if (!ctx) return;
  ctx.logger.info(`[retell-voice] 📞 Call ended: ${session.callId}`);
  ctx.activeCalls.delete(session.callId);
}

/**
 * Generate a response using the OpenClaw agent via Gateway WebSocket.
 * This uses chat.send which runs the full agent with tools.
 */
async function generateAgentResponse(session: CallSession, userMessage: string): Promise<string> {
  if (!ctx) {
    throw new Error("Server context not initialized");
  }

  // Ensure gateway is connected
  if (!ctx.gateway.isConnected()) {
    await ctx.gateway.connect();
  }

  // Build voice-specific system prompt
  const voicePrompt = `You are speaking on a phone call. The caller's number is ${session.fromNumber || "unknown"}.

VOICE CALL GUIDELINES:
- Keep responses SHORT and conversational (1-3 sentences max)
- Be concise - the caller may be driving or multitasking  
- Use natural speech patterns, not formal writing
- Don't use markdown, bullet points, or formatting - just speak naturally
- You have full access to tools - use them when helpful
- If you need to do something that takes time, say so briefly

Be helpful, direct, and sound like a friend - not a corporate assistant.`;

  // Add conversation context
  let extraSystemPrompt = voicePrompt;
  if (session.transcript.length > 1) {
    const history = session.transcript
      .slice(0, -1)
      .map((t) => `${t.role === "agent" ? "You" : "Caller"}: ${t.content}`)
      .join("\n");
    extraSystemPrompt = `${voicePrompt}\n\nRecent conversation:\n${history}`;
  }

  // Send to gateway and get response
  const result = await ctx.gateway.chat({
    sessionKey: session.sessionKey,
    message: userMessage,
    systemContext: extraSystemPrompt,
    timeoutMs: ctx.config.responseTimeoutMs || 30000,
  });

  if (!result.text) {
    if (result.aborted) {
      return "Sorry, I ran out of time on that one. What were you asking?";
    }
    return "Hmm, I'm not sure what to say. Can you try again?";
  }

  return result.text;
}
