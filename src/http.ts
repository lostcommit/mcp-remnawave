import { randomUUID } from 'node:crypto';
import {
    createServer as createHttpServer,
    Server,
    ServerResponse,
} from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Config } from './config.js';
import { createServer } from './server.js';

const MCP_PATH = '/mcp';
const HEALTH_PATH = '/healthz';

function sendJson(
    response: ServerResponse,
    statusCode: number,
    body: Record<string, string>,
) {
    response.writeHead(statusCode, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(body));
}

export async function startHttpServer(config: Config): Promise<Server> {
    const sessions = new Map<
        string,
        {
            server: ReturnType<typeof createServer>;
            transport: StreamableHTTPServerTransport;
        }
    >();

    const httpServer = createHttpServer(async (request, response) => {
        const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

        if (request.method === 'GET' && url.pathname === HEALTH_PATH) {
            sendJson(response, 200, { status: 'ok' });
            return;
        }

        if (url.pathname !== MCP_PATH) {
            sendJson(response, 404, { error: 'Not found' });
            return;
        }

        const sessionId = request.headers['mcp-session-id'];
        const requestedSessionId = Array.isArray(sessionId)
            ? sessionId[0]
            : sessionId;
        const existingSession = requestedSessionId
            ? sessions.get(requestedSessionId)
            : undefined;

        if (requestedSessionId && !existingSession) {
            sendJson(response, 404, { error: 'Unknown MCP session' });
            return;
        }

        let server = existingSession?.server;
        let transport = existingSession?.transport;
        let isNewSession = false;

        if (!server || !transport) {
            isNewSession = true;
            server = createServer(config);
            transport = new StreamableHTTPServerTransport({
                enableJsonResponse: true,
                sessionIdGenerator: randomUUID,
                onsessioninitialized: (id) => {
                    sessions.set(id, { server: server!, transport: transport! });
                },
            });
            transport.onclose = () => {
                if (transport?.sessionId) {
                    sessions.delete(transport.sessionId);
                }
            };
        }

        try {
            if (isNewSession) {
                await server.connect(transport);
            }
            await transport.handleRequest(request, response);
        } catch (error) {
            if (!response.headersSent) {
                sendJson(response, 500, { error: 'Failed to handle MCP request' });
            }
            process.stderr.write(
                `Failed to handle MCP HTTP request: ${error instanceof Error ? error.message : String(error)}\n`,
            );
        }
    });

    await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(config.http.port, config.http.host, () => {
            httpServer.off('error', reject);
            resolve();
        });
    });

    return httpServer;
}
