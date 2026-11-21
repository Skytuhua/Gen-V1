import { useEffect, useRef } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { bracketMatching } from "@codemirror/language";

const readOnly: Extension[] = [
	lineNumbers(),
	bracketMatching(),
	EditorState.readOnly.of(true),
	EditorView.editable.of(false),
];

/** Read-only side-by-side disk-vs-mine view for the conflict bar's Compare action. */
export default function CompareView({
	left,
	right,
}: {
	left: string;
	right: string;
}) {
	const host = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const merge = new MergeView({
			a: { doc: left, extensions: readOnly },
			b: { doc: right, extensions: readOnly },
			orientation: "a-b",
			parent: host.current!,
		});
		return () => merge.destroy();
	}, [left, right]);
	return (
		<div className="files-compare">
			<div className="files-compare-labels" aria-hidden="true">
				<span>On disk</span>
				<span>Your changes</span>
			</div>
			<div className="files-compare-panes" ref={host} />
		</div>
	);
}
