import type { z } from 'zod';
import { buildToolName, toolBehaviorHints, type ToolBehaviorHints } from './tool-registry.js';
import type { ToolCallResult } from './tool-execution.js';

/** One registered MCP tool: its advertised contract plus the handler `tools/call` invokes. */
export type McpToolDefinition = {
    /** The wire name clients see. */
    name: string;
    description: string;
    inputSchema: z.ZodType;
    annotations: ToolBehaviorHints;
    handler: (args: unknown) => Promise<ToolCallResult>;
};

/**
 * Builds a tool definition from one PascalCase name, so the wire name and the behaviour hints are
 * both derived from it rather than restated by hand at each tool.
 *
 * The handler is typed against the schema at the call site and erased to `unknown` here: the SDK
 * validates arguments against that same schema before invoking a handler, so the single cast below
 * is checked at runtime by the layer that performs the call, not merely asserted.
 */
export function defineTool<Schema extends z.ZodType>({
    methodName,
    description,
    inputSchema,
    handler,
}: {
    methodName: string;
    description: string;
    inputSchema: Schema;
    handler: (args: z.infer<Schema>) => Promise<ToolCallResult>;
}): McpToolDefinition {
    return {
        name: buildToolName(methodName),
        description,
        inputSchema,
        annotations: toolBehaviorHints(methodName),
        handler: (args: unknown) => handler(args as z.infer<Schema>),
    };
}
