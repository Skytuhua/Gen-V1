// R03 loopback address rules for the "Check a local app" dialog.
// Mirror of loopbackAuditUrl in apps/desktop/window-policy.ts — kept separate
// because that module pulls node:net/node:dns which cannot load in the web
// bundle. The desktop re-validates on every run.
const MESSAGE =
	"Use a localhost address. Public pages can be checked from the browser with Check this page.";

export function localAuditUrl(raw: string): URL {
	if (raw.length > 2048 || /[\u0000-\u0020\\]/.test(raw)) throw Error(MESSAGE);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw Error(MESSAGE);
	}
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		!["http:", "https:"].includes(url.protocol) ||
		!(host === "localhost" || host === "127.0.0.1" || host === "::1") ||
		url.username ||
		url.password
	)
		throw Error(MESSAGE);
	if (url.port && (Number(url.port) < 1 || Number(url.port) > 65535))
		throw Error(MESSAGE);
	url.hash = "";
	return url;
}
