import { describe, expect, it } from "vitest";
import { displayFilePath } from "../apps/web/src/files/FilesView.tsx";

// displayFilePath renders invisible filename characters explicitly while keeping
// the raw path for reads (apps/web/src/files/FilesView.tsx).
describe("displayFilePath", () => {
	it("returns ordinary paths unchanged", () => {
		expect(displayFilePath("src/main.tsx")).toBe("src/main.tsx");
		expect(displayFilePath("dir/é — ü.ts")).toBe("dir/é — ü.ts");
	});

	it("escapes tab, newline and carriage return with readable shorthands", () => {
		expect(displayFilePath("a\tb")).toBe("a\\tb");
		expect(displayFilePath("a\nb")).toBe("a\\nb");
		expect(displayFilePath("a\rb")).toBe("a\\rb");
	});

	it("escapes other control characters as \\uXXXX", () => {
		expect(displayFilePath("a\x01b")).toBe("a\\u0001b");
		expect(displayFilePath("a\x1fb")).toBe("a\\u001fb");
		expect(displayFilePath("a\x7fb")).toBe("a\\u007fb");
	});

	it("escapes every control character in a mixed name", () => {
		expect(displayFilePath("x\ty\nz\x01w")).toBe("x\\ty\\nz\\u0001w");
	});

	it("leaves bytes outside the escaped range untouched, including NUL", () => {
		// \x00 is not in the escaped range; assert the documented boundary.
		expect(displayFilePath("a\0b")).toBe("a\0b");
		expect(displayFilePath("a b")).toBe("a b");
	});
});
