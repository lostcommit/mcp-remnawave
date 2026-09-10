import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import {
    RemnawaveV3Client,
    type V3OperationDescriptor,
    type V3ParameterDescriptor,
} from './client.js';

type Manifest = readonly V3OperationDescriptor[];

function parameters(operation: V3OperationDescriptor, location: 'path' | 'query'): readonly V3ParameterDescriptor[] {
    const named = location === 'path' ? operation.pathParameters : operation.queryParameters;
    return named ?? operation.parameters?.filter((parameter) => parameter.in === location) ?? [];
}

function parameterSchema(parameter: V3ParameterDescriptor): ZodTypeAny {
    const type = typeof parameter.schema === 'object' && parameter.schema !== null
        && 'type' in parameter.schema && typeof parameter.schema.type === 'string'
        ? parameter.schema.type
        : undefined;
    let schema: ZodTypeAny;
    if (type === 'integer' || type === 'number') schema = z.number();
    else if (type === 'boolean') schema = z.boolean();
    else if (type === 'array') schema = z.array(z.unknown());
    else if (type === 'object') schema = z.record(z.unknown());
    else schema = z.string();
    if (parameter.description) schema = schema.describe(parameter.description);
    return parameter.required === false ? schema.optional() : schema;
}

function parameterObject(parametersList: readonly V3ParameterDescriptor[], label: string): ZodTypeAny {
    const fields: Record<string, ZodTypeAny> = {};
    for (const parameter of parametersList) fields[parameter.name] = parameterSchema(parameter);
    const schema = z.object(fields);
    return parametersList.some((parameter) => parameter.required !== false)
        ? schema.describe(label)
        : schema.optional().describe(label);
}

function bodySchema(operation: V3OperationDescriptor): ZodTypeAny | undefined {
    const requestBody = operation.requestBody ?? operation.requestBodies?.find(
        (candidate) => !('contentType' in candidate) || candidate.contentType === 'application/json',
    );
    if (!requestBody) return undefined;
    // All JSON request bodies in the pinned Remnawave v3 specification are
    // objects. A passthrough object keeps the schema honest (and, unlike
    // z.any(), lets MCP advertise a required body) without duplicating every
    // component schema in the generated operation manifest.
    let schema: ZodTypeAny = z.object({}).passthrough();
    if (requestBody.description) schema = schema.describe(requestBody.description);
    return requestBody.required === false ? schema.optional() : schema;
}

function toolName(operation: V3OperationDescriptor): string {
    const source = operation.toolName ?? operation.operationId;
    if (!source) throw new Error(`v3 operation missing operationId for ${operation.method} ${operation.pathTemplate ?? operation.path ?? ''}`);
    return source;
}

function toolDescription(operation: V3OperationDescriptor): string {
    const summary = operation.summary ?? operation.description ?? 'Remnawave API operation';
    return `${summary} (${operation.method.toUpperCase()} ${operation.pathTemplate ?? operation.path ?? ''})`;
}

function successResult(value: unknown) {
    return {
        content: [{
            type: 'text' as const,
            text: value === undefined ? 'Success (no content).' : JSON.stringify(value, null, 2),
        }],
    };
}

function errorResult(error: unknown) {
    return {
        content: [{
            type: 'text' as const,
            text: `Error: ${error instanceof Error ? error.message : 'Remnawave API request failed'}`,
        }],
        isError: true,
    };
}

/** Register exactly one MCP tool for each v3 OpenAPI operation. */
export function registerV3Tools(server: McpServer, client: RemnawaveV3Client, readonly: boolean, manifest: Manifest) {
    for (const operation of manifest) {
        if (readonly && operation.method.toUpperCase() !== 'GET') continue;
        const schema: Record<string, ZodTypeAny> = {};
        const path = parameters(operation, 'path');
        const query = parameters(operation, 'query');
        if (path.length) schema.path = parameterObject(path, 'Path parameters');
        if (query.length) schema.query = parameterObject(query, 'Query parameters');
        const body = bodySchema(operation);
        if (body) schema.body = body;

        server.tool(toolName(operation), toolDescription(operation), schema, async (input) => {
            try {
                return successResult(await client.invoke(operation, input));
            } catch (error) {
                return errorResult(error);
            }
        });
    }
}
