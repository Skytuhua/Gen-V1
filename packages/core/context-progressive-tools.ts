import { z } from 'zod';
import type { ContextToolExposure } from './context-tool-discovery.ts';

export const contextDiscoverArgs = z.strictObject({ query: z.string().max(128) });
export const contextDescribeArgs = z.strictObject({ name: z.string().min(1).max(128) });
export const CONTEXT_DISCOVER_TOOLS = {
  name: 'context_discover_tools',
  description: 'Search admitted tool names and concise descriptions. Discovering a tool does not grant access.',
  parameters: z.toJSONSchema(contextDiscoverArgs) as Record<string, unknown>,
};
export const CONTEXT_DESCRIBE_TOOL = {
  name: 'context_describe_tool',
  description: 'Read an admitted tool schema and include it in the next request. Does not invoke a tool or grant access.',
  parameters: z.toJSONSchema(contextDescribeArgs) as Record<string, unknown>,
};
const deferredReads = new Set(['repository_map', 'repository_status', 'repository_log', 'database_inspect', 'database_schema', 'database_query', 'pdf_inspect']);
const blockedHostNames = new Set(['bash', 'powershell', 'read', 'write', 'edit', 'find', 'grep', 'ls', 'codemode', 'tool_search']);
export const hermesContextExposure = (name: string, widgetsEnabled: boolean): ContextToolExposure =>
  blockedHostNames.has(name) || name === 'ui_create_widget' && !widgetsEnabled ? 'HIDDEN' : deferredReads.has(name) ? 'DEFERRED' : 'DIRECT';

export const isBoundedContextRead = (name: string) => deferredReads.has(name) || name === 'context_result_read';
