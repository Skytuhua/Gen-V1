import type { PluginHostContext } from "@gen-v1/plugin-api";
import { acquireProfileLease } from "@gen-v1/plugin-api/host-utilities";
import { createVisualDocumentHost as createDocumentHost } from "./document-host";
export const createVisualDocumentHost = (context: PluginHostContext) =>
	createDocumentHost(context, acquireProfileLease);
export default { activate: createVisualDocumentHost };
