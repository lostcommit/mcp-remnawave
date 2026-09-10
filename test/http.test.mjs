import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import test from 'node:test';

async function getFreePort() {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    server.close();
    await once(server, 'close');
    return address.port;
}

async function waitForHttpServer(child) {
    let stderr = '';

    await new Promise((resolve, reject) => {
        const onData = (chunk) => {
            stderr += chunk;
            if (stderr.includes('/mcp')) {
                cleanup();
                resolve();
            }
        };
        const onExit = (code) => {
            cleanup();
            reject(new Error(`Server stopped before listening: ${code}; ${stderr}`));
        };
        const cleanup = () => {
            child.stderr.off('data', onData);
            child.off('exit', onExit);
        };

        child.stderr.on('data', onData);
        child.once('exit', onExit);
    });
}

test('serves MCP requests over HTTP', { timeout: 10_000 }, async (t) => {
    const port = await getFreePort();
    const child = spawn(process.execPath, ['dist/index.js'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            REMNAWAVE_BASE_URL: 'https://panel.example.test',
            REMNAWAVE_API_TOKEN: 'test-token',
            MCP_HTTP_ENABLED: 'true',
            MCP_HTTP_HOST: '127.0.0.1',
            MCP_HTTP_PORT: String(port),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill();
            await once(child, 'exit');
        }
    });

    await waitForHttpServer(child);

    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const headers = {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
    };
    const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2025-11-25',
                capabilities: {},
                clientInfo: { name: 'http-test', version: '1.0.0' },
            },
        }),
    });

    assert.equal(initialize.status, 200);
    const sessionId = initialize.headers.get('mcp-session-id');
    assert.ok(sessionId);
    assert.equal((await initialize.json()).result.serverInfo.version, '1.2.0');

    const tools = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
            ...headers,
            'mcp-protocol-version': '2025-11-25',
            'mcp-session-id': sessionId,
        },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/list',
            params: {},
        }),
    });

    assert.equal(tools.status, 200);
    assert.equal((await tools.json()).result.tools.length, 153);
});
