export interface Config {
    baseUrl: string;
    apiToken: string;
    requestTimeoutMs: number;
    apiKey?: string;
    cfAccessClientId?: string;
    cfAccessClientSecret?: string;
    readonly: boolean;
    http: {
        enabled: boolean;
        host: string;
        port: number;
    };
}

export function loadConfig(): Config {
    const baseUrl = process.env.REMNAWAVE_BASE_URL;
    const apiToken = process.env.REMNAWAVE_API_TOKEN;
    const apiKey = process.env.REMNAWAVE_API_KEY;
    const requestTimeoutMs = Number(process.env.REMNAWAVE_REQUEST_TIMEOUT_MS || '30000');
    const cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
    const cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    const readonly = process.env.REMNAWAVE_READONLY === 'true';
    const httpEnabled = process.env.MCP_HTTP_ENABLED === 'true';
    const httpHost = process.env.MCP_HTTP_HOST || '127.0.0.1';
    const httpPort = Number(process.env.MCP_HTTP_PORT || '3100');

    if (!baseUrl) {
        throw new Error('REMNAWAVE_BASE_URL environment variable is required');
    }
    if (!apiToken) {
        throw new Error('REMNAWAVE_API_TOKEN environment variable is required');
    }
    if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
        throw new Error('REMNAWAVE_REQUEST_TIMEOUT_MS must be a positive integer');
    }
    if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
        throw new Error('MCP_HTTP_PORT must be an integer between 1 and 65535');
    }

    return {
        baseUrl: baseUrl.replace(/\/+$/, ''),
        apiToken,
        requestTimeoutMs,
        apiKey,
        cfAccessClientId,
        cfAccessClientSecret,
        readonly,
        http: {
            enabled: httpEnabled,
            host: httpHost,
            port: httpPort,
        },
    };
}
