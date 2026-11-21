import { useEffect, useRef } from "react";
import {
	Compartment,
	EditorState,
	Prec,
	type Extension,
	type Text,
} from "@codemirror/state";
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import {
	LanguageDescription,
	bracketMatching,
	defaultHighlightStyle,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import {
	highlightSelectionMatches,
	search,
	searchKeymap,
} from "@codemirror/search";
import { editLineSeparator } from "./manual-edit-state";

/** Imperative surface the edit host uses: the doc the server will receive. */
export interface CodeEditorHandle {
	view: EditorView;
	/** Current document text (joined with the configured separator). */
	document(): string;
	/** Replace the whole document (disk reload, draft restore), keeping the cursor line when possible. */
	replaceAll(text: string): void;
	focus(): void;
}

interface CodeEditorProps {
	path: string;
	initialText: string;
	lineSeparator: "lf" | "crlf" | "mixed";
	/** Shell word-wrap preference (`data-word-wrap` on `.app-shell`). */
	wordWrap: boolean;
	readOnly?: boolean;
	/** The last saved/loaded doc; dirty is `state.doc.eq(loadedDoc.current)`. */
	loadedDoc: { current: Text | undefined };
	onDirty: (dirty: boolean) => void;
	onSave: () => void;
	onDone: () => void;
	handleRef: { current: CodeEditorHandle | undefined };
}

export default function CodeEditor({
	path,
	initialText,
	lineSeparator,
	wordWrap,
	readOnly = false,
	loadedDoc,
	onDirty,
	onSave,
	onDone,
	handleRef,
}: CodeEditorProps) {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const language = new Compartment(),
			wrap = new Compartment();
		const view = new EditorView({
			parent: host.current!,
			state: EditorState.create({
				doc: initialText,
				extensions: [
					lineNumbers(),
					highlightActiveLine(),
					highlightActiveLineGutter(),
					history(),
					drawSelection(),
					indentOnInput(),
					bracketMatching(),
					highlightSelectionMatches(),
					search({ top: true }),
					EditorState.lineSeparator.of(editLineSeparator(lineSeparator)),
					language.of([]),
					wrap.of(wordWrap ? EditorView.lineWrapping : []),
					EditorView.updateListener.of((update) => {
						if (update.docChanged)
							onDirty(!(loadedDoc.current && update.state.doc.eq(loadedDoc.current)));
					}),
					Prec.highest(
						keymap.of([
							{
								key: "Mod-s",
								run: () => {
									onSave();
									return true;
								},
							},
							{
								key: "Escape",
								run: () => {
									onDone();
									return true;
								},
							},
						]),
					),
					keymap.of([
						...defaultKeymap,
						...historyKeymap,
						...searchKeymap,
						indentWithTab,
					]),
					readOnly
						? [
								EditorState.readOnly.of(true),
								EditorView.editable.of(false),
							]
						: [],
					syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				],
			}),
		});
		// loadedDoc stays owned by the host: an opened draft is dirty vs the file.
		handleRef.current = {
			view,
			document: () => view.state.doc.toString(),
			replaceAll: (text) => {
				const scrollTop = view.scrollDOM.scrollTop;
				view.dispatch({
					changes: { from: 0, to: view.state.doc.length, insert: text },
				});
				loadedDoc.current = view.state.doc;
				view.scrollDOM.scrollTop = scrollTop;
			},
			focus: () => view.focus(),
		};
		let destroyed = false;
		const description = LanguageDescription.matchFilename(languages, path);
		if (description)
			void description
				.load()
				.then((support) => {
					if (!destroyed)
						view.dispatch({
							effects: language.reconfigure(support as Extension),
						});
				})
				.catch(() => {});
		return () => {
			destroyed = true;
			handleRef.current = undefined;
			view.destroy();
		};
		// The editor mounts once per open file; reloads flow through the handle.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
	return <div className="gen-code-editor" ref={host} aria-label={`Edit ${path}`} />;
}
