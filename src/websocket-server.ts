/**
 * WebSocket server for Retell AI Custom LLM protocol.
 * Handles incoming calls and routes to OpenClaw agent for responses.
 */

import crypto from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { loadCoreAgentDeps, type CoreConfig, type CoreAgentDeps } from "./core-bridge.js";
import { isAllowedCaller, normalizePhone, type RetellVoiceConfig } from "./config.js";

interface CallSession {
  callId: string;
  fromNumber?: string;
  authorized: boolean;
  transcript: Array<{ role: "user" | "agent"; content: string }>;
  sessionId: string;
  sessionKey: string;
}

interface ServerContext {
  config: RetellVoiceConfig;
  coreConfig: CoreConfig;
  logger: any;
  wss: WebSocketServer | null;
  activeCalls: Map<string, CallSession>;
  deps: CoreAgentDeps | null;
}

let ctx: ServerContext | null = null;

/**
 * Start the WebSocket server for Retell Custom LLM connections
 */
export async function startWebSocketServer(opts: {
  config: RetellVoiceConfig;
  coreConfig: CoreConfig;
  logger: any;
}): Promise<void> {
  if (ctx?.wss) {
    throw new Error("Server already running");
  }

  // Pre-load core dependencies
  const deps = await loadCoreAgentDeps();

  // Accept any path - let the connection handler extract the call ID
  // Funnel strips the /llm-websocket prefix, so we get just /{call_id}
  const wss = new WebSocketServer({
    port: opts.config.websocket.port,
  });

  ctx = {
    config: opts.config,
    coreConfig: opts.coreConfig,
    logger: opts.logger,
    wss,
    activeCalls: new Map(),
    deps,
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
    sessionId: crypto.randomUUID(),
    sessionKey: `retell:${callId}`,
  };

  ctx.activeCalls.set(callId, session);

  // Send initial config - request call details for caller verification
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
      session.fromNumber = call.from_number;
      
      ctx.logger.info(`[retell-voice] 📱 Caller: ${session.fromNumber}`);

      if (!isAllowedCaller(session.fromNumber || "", ctx.config.allowFrom)) {
        ctx.logger.warn(`[retell-voice] 🚫 Unauthorized: ${session.fromNumber}`);
        ws.send(JSON.stringify({
          response_type: "response",
          response_id: 0,
          content: "Sorry, this number is not authorized. Goodbye.",
          content_complete: true,
          end_call: true,
        }));
        return;
      }

      // Caller authorized - update session key based on phone
      const normalizedPhone = normalizePhone(session.fromNumber || session.callId);
      session.sessionKey = `retell:${normalizedPhone}`;
      session.authorized = true;

      ctx.logger.info(`[retell-voice] ✅ Authorized: ${session.fromNumber}`);

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
      // If we haven't received call details yet, wait for authorization
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

      // Get transcript from event
      const transcript = event.transcript || [];
      
      // Find the last user message
      const userMessages = transcript.filter((t: any) => t.role === "user");
      const lastUserMessage = userMessages[userMessages.length - 1];
      
      if (!lastUserMessage?.content) {
        // No user message yet, send a prompt
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

      // Generate response using OpenClaw agent
      try {
        const response = await generateAgentResponse(session, lastUserMessage.content);
        
        ctx.logger.info(`[retell-voice] 🤖 Response: ${response.substring(0, 50)}...`);

        // Check for hangup intent
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

    // update_only events are just transcript updates, no response needed

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
 * Generate a response using the OpenClaw agent with full tool access
 */
async function generateAgentResponse(session: CallSession, userMessage: string): Promise<string> {
  if (!ctx || !ctx.deps) {
    throw new Error("Core dependencies not loaded");
  }

  const deps = ctx.deps;
  const cfg = ctx.coreConfig;
  const voiceConfig = ctx.config;

  const agentId = "main";

  // Resolve paths
  const storePath = deps.resolveStorePath(cfg.session?.store, { agentId });
  const agentDir = deps.resolveAgentDir(cfg, agentId);
  const workspaceDir = deps.resolveAgentWorkspaceDir(cfg, agentId);

  // Ensure workspace exists
  await deps.ensureAgentWorkspace({ dir: workspaceDir });

  // Load or create session entry
  const sessionStore = deps.loadSessionStore(storePath);
  const now = Date.now();
  let sessionEntry = sessionStore[session.sessionKey] as { sessionId: string; updatedAt: number } | undefined;

  if (!sessionEntry) {
    sessionEntry = {
      sessionId: session.sessionId,
      updatedAt: now,
    };
    sessionStore[session.sessionKey] = sessionEntry;
    await deps.saveSessionStore(storePath, sessionStore);
  }

  const sessionFile = deps.resolveSessionFilePath(sessionEntry.sessionId, sessionEntry, { agentId });

  // Resolve model
  const modelRef = voiceConfig.responseModel || `${deps.DEFAULT_PROVIDER}/${deps.DEFAULT_MODEL}`;
  const slashIndex = modelRef.indexOf("/");
  const provider = slashIndex === -1 ? deps.DEFAULT_PROVIDER : modelRef.slice(0, slashIndex);
  const model = slashIndex === -1 ? modelRef : modelRef.slice(slashIndex + 1);

  // Resolve thinking level
  const thinkLevel = deps.resolveThinkingDefault({ cfg, provider, model });

  // Resolve agent identity
  const identity = deps.resolveAgentIdentity(cfg, agentId);
  const agentName = identity?.name?.trim() || "assistant";

  // Build voice-specific system prompt
  const basePrompt = `You are ${agentName}, speaking on a phone call. The caller's number is ${session.fromNumber || "unknown"}.

VOICE CALL GUIDELINES:
- Keep responses SHORT and conversational (1-3 sentences max)
- Be concise - the caller may be driving or multitasking  
- Use natural speech patterns, not formal writing
- Don't use markdown, bullet points, or formatting - just speak naturally
- You have full access to tools - use them when helpful
- If you need to do something that takes time, say so briefly

Be helpful, direct, and sound like a friend - not a corporate assistant.`;

  // Add conversation context
  let extraSystemPrompt = basePrompt;
  if (session.transcript.length > 1) {
    const history = session.transcript
      .slice(0, -1) // Exclude the current message
      .map((t) => `${t.role === "agent" ? "You" : "Caller"}: ${t.content}`)
      .join("\n");
    extraSystemPrompt = `${basePrompt}\n\nRecent conversation:\n${history}`;
  }

  // Resolve timeout
  const timeoutMs = voiceConfig.responseTimeoutMs || deps.resolveAgentTimeoutMs({ cfg });
  const runId = `retell:${session.callId}:${Date.now()}`;

  // Run the agent
  const result = await deps.runEmbeddedPiAgent({
    sessionId: sessionEntry.sessionId,
    sessionKey: session.sessionKey,
    messageProvider: "retell",
    sessionFile,
    workspaceDir,
    config: cfg,
    prompt: userMessage,
    provider,
    model,
    thinkLevel,
    verboseLevel: "off",
    timeoutMs,
    runId,
    lane: "retell",
    extraSystemPrompt,
    agentDir,
  });

  // Extract text from payloads
  const texts = (result.payloads ?? [])
    .filter((p) => p.text && !p.isError)
    .map((p) => p.text?.trim())
    .filter(Boolean);

  const text = texts.join(" ");

  if (!text) {
    if (result.meta?.aborted) {
      return "Sorry, I ran out of time on that one. What were you asking?";
    }
    return "Hmm, I'm not sure what to say. Can you try again?";
  }

  return text;
}
