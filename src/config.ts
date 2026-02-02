/**
 * Retell Voice plugin configuration types
 */

export interface RetellVoiceConfig {
  enabled: boolean;
  apiKey?: string;
  allowFrom: string[];
  greeting: string;
  websocket: {
    port: number;
    path: string;
  };
  tailscale: {
    mode: "off" | "serve" | "funnel";
    path?: string;
  };
  responseModel?: string;
  responseTimeoutMs: number;
}

/**
 * Normalize a phone number for comparison
 * Removes spaces, dashes, parentheses, and handles +1 prefix
 */
export function normalizePhone(phone: string): string {
  // Remove all non-digit characters except leading +
  let normalized = phone.replace(/[^\d+]/g, "");
  
  // Ensure it starts with + for E.164
  if (!normalized.startsWith("+") && normalized.length >= 10) {
    // Assume US if 10 digits
    if (normalized.length === 10) {
      normalized = "+1" + normalized;
    } else if (normalized.length === 11 && normalized.startsWith("1")) {
      normalized = "+" + normalized;
    }
  }
  
  return normalized;
}

/**
 * Check if a phone number is in the allowed list
 */
export function isAllowedCaller(phone: string, allowList: string[]): boolean {
  if (allowList.length === 0) return true; // No restrictions
  
  const normalized = normalizePhone(phone);
  
  return allowList.some(allowed => {
    const normalizedAllowed = normalizePhone(allowed);
    return normalized === normalizedAllowed;
  });
}
