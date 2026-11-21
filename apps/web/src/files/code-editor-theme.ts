import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * Manual-edit editor chrome, per plan DESIGN §8.2. Colors come from the CSS
 * custom properties declared on `.gen-code-editor` in files.css so the editor
 * follows light/dark and high-contrast without a second palette here.
 */
export const codeEditorTheme = EditorView.theme({
	"&": {
		backgroundColor: "var(--surface)",
		color: "var(--text)",
		height: "100%",
		fontSize: "var(--code-font-size, 14px)",
	},
	".cm-content": {
		fontFamily: "var(--code-font, monospace)",
		lineHeight: "1.65",
		caretColor: "var(--text)",
		paddingBottom: "12px",
	},
	".cm-cursor, .cm-cursor-primary": {
		borderLeftColor: "var(--text)",
		borderLeftWidth: "2px",
	},
	".cm-gutters": {
		backgroundColor: "var(--surface)",
		color: "var(--muted)",
		border: "none",
		fontFamily: "var(--code-font, monospace)",
	},
	".cm-activeLine": {
		backgroundColor:
			"color-mix(in srgb, var(--selection-bg) 60%, transparent)",
	},
	".cm-activeLineGutter": {
		backgroundColor: "transparent",
		color: "var(--text)",
	},
	".cm-selectionMatch": {
		backgroundColor:
			"color-mix(in srgb, var(--muted) 30%, transparent)",
	},
	"&.cm-focused .cm-matchingBracket": {
		outline: "1px solid var(--muted)",
		backgroundColor: "transparent",
	},
	".cm-searchMatch": {
		backgroundColor:
			"color-mix(in srgb, var(--warning-fg) 25%, transparent)",
	},
	".cm-searchMatch.cm-searchMatch-selected": {
		backgroundColor:
			"color-mix(in srgb, var(--warning-fg) 45%, transparent)",
	},
	"&.cm-focused": {
		outline: "1px solid var(--ui-focus-ring, var(--accent))",
		outlineOffset: "-1px",
	},
	".cm-panels": {
		backgroundColor: "var(--surface)",
		color: "var(--text)",
	},
	".cm-panels input, .cm-panels button": {
		fontSize: "12px",
	},
});

/**
 * §8.3 syntax table: Lezer tags bound to the per-theme custom properties that
 * files.css defines under `.gen-code-editor` (dark values; `[data-theme=light]`
 * overrides). Each pair is audited ≥ 4.5:1 by tests/manual-edit-theme.test.ts.
 */
export const codeHighlightStyle = HighlightStyle.define([
	{ tag: [tags.keyword, tags.controlKeyword, tags.modifier], color: "var(--gen-syn-keyword)" },
	{ tag: [tags.string, tags.special(tags.string)], color: "var(--gen-syn-string)" },
	{ tag: [tags.number, tags.bool, tags.null], color: "var(--gen-syn-number)" },
	{
		tag: [tags.comment, tags.lineComment, tags.blockComment],
		color: "var(--gen-syn-comment)",
		fontStyle: "italic",
	},
	{
		tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
		color: "var(--gen-syn-function)",
	},
	{
		tag: [tags.typeName, tags.className, tags.namespace],
		color: "var(--gen-syn-type)",
	},
	{
		tag: [tags.propertyName, tags.attributeName],
		color: "var(--gen-syn-property)",
	},
	{
		tag: [tags.variableName, tags.definition(tags.variableName)],
		color: "var(--gen-syn-variable)",
	},
	{ tag: [tags.tagName], color: "var(--gen-syn-tag)" },
	{
		tag: [tags.heading],
		color: "var(--gen-syn-tag)",
		fontWeight: "bold",
	},
	{
		tag: [tags.operator, tags.punctuation],
		color: "var(--gen-syn-variable)",
	},
	{
		tag: [tags.link, tags.url],
		color: "var(--gen-syn-link)",
		textDecoration: "underline",
	},
	{ tag: [tags.invalid], color: "var(--gen-syn-invalid)" },
]);
