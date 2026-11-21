import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hostFlagEnabled } from "../../packages/core/host-flags.ts";

/** Registered beneath the existing Host, Origin, session and CSRF hooks. The
 * desktop renderer mirrors this answer through its own capability IPC so the
 * toolbar never offers a check the host would refuse. */
export function registerAccessibilityAuditRoutes(app: FastifyInstance): void {
	app.get(
		"/api/browser/accessibility-audit/capability",
		async (request, reply) => {
			reply.header("Cache-Control", "no-store");
			z.strictObject({}).parse(request.query);
			return { available: hostFlagEnabled("browser.accessibilityAuditV1") };
		},
	);
}
