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
export declare function normalizePhone(phone: string): string;
/**
 * Check if a phone number is in the allowed list
 */
export declare function isAllowedCaller(phone: string, allowList: string[]): boolean;
//# sourceMappingURL=config.d.ts.map