import Fastify from "fastify";
import { afterEach, expect, it } from "vitest";
import { registerAccessibilityAuditRoutes } from "../apps/server/accessibility-audit-routes.ts";
import { hostFlagEnabled } from "../packages/core/host-flags.ts";

const envKey = "HARNESS_FLAG_BROWSER_ACCESSIBILITY_AUDIT_V1";
afterEach(() => {
	delete process.env[envKey];
});

it("reports the accessibility audit capability only while the host flag is on", async () => {
	const app = Fastify();
	registerAccessibilityAuditRoutes(app);
	expect(
		(await app.inject("/api/browser/accessibility-audit/capability")).json(),
	).toEqual({ available: false });
	process.env[envKey] = "1";
	expect(
		(await app.inject("/api/browser/accessibility-audit/capability")).json(),
	).toEqual({ available: true });
});

it("shares the launch-token custody rules of other desktop controls", async () => {
	expect(
		hostFlagEnabled("browser.accessibilityAuditV1", { [envKey]: "yes" }),
	).toBe(false);
	expect(
		hostFlagEnabled("browser.accessibilityAuditV1", { [envKey]: "true" }),
	).toBe(true);
});
