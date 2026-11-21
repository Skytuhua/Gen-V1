import { useMemo, useRef, useState } from 'react';
import { Popover } from '../../../../packages/ui-shell/Popover';

export interface SqlEditorProps {
	value: string;
	onChange: (value: string) => void;
	onRun: () => void;
	completions: string[];
	historyKey?: string;
	disabled?: boolean;
}

const historyKey = (connectionId: string) => `harness:database-history:${connectionId}`;
export function readSqlHistory(connectionId: string): string[] {
	try { const parsed = JSON.parse(localStorage.getItem(historyKey(connectionId)) ?? '[]'); return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string').slice(0, 50) : []; }
	catch { return []; }
}
export function recordSqlHistory(connectionId: string, sql: string) {
	const text = sql.trim();
	if (!text) return;
	try { localStorage.setItem(historyKey(connectionId), JSON.stringify([text, ...readSqlHistory(connectionId).filter(entry => entry !== text)].slice(0, 50))); }
	catch { /* storage unavailable — recall is best-effort */ }
}

const currentWord = (value: string, caret: number) => {
	const match = /[A-Za-z_][A-Za-z0-9_]*$/.exec(value.slice(0, caret));
	return match ? { word: match[0], start: caret - match[0].length } : null;
};

export function SqlEditor({ value, onChange, onRun, completions, historyKey: ownerKey, disabled = false }: SqlEditorProps) {
	const input = useRef<HTMLTextAreaElement>(null);
	const [caret, setCaret] = useState(0);
	const [picked, setPicked] = useState(0);
	const [historyIndex, setHistoryIndex] = useState<number | null>(null);
	const [closed, setClosed] = useState(false);
	const stash = useRef('');
	const word = currentWord(value, caret);
	const suggestions = useMemo(() => {
		if (!word || word.word.length < 2) return [];
		const prefix = word.word.toLowerCase();
		return completions.filter(name => name.toLowerCase().startsWith(prefix) && name !== word.word).slice(0, 8);
	}, [word, completions]);
	const lines = value.split('\n').length;
	const accept = (index: number) => {
		const target = suggestions[index];
		if (!target || !word) return;
		const next = value.slice(0, word.start) + target + value.slice(caret);
		onChange(next);
		const position = word.start + target.length;
		setCaret(position);
		requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(position, position); });
	};
	const keyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); setHistoryIndex(null); onRun(); return; }
		if (suggestions.length > 0) {
			if (event.key === 'ArrowDown') { event.preventDefault(); setPicked(index => (index + 1) % suggestions.length); return; }
			if (event.key === 'ArrowUp') { event.preventDefault(); setPicked(index => (index - 1 + suggestions.length) % suggestions.length); return; }
			if (event.key === 'Tab' || event.key === 'Enter') { event.preventDefault(); accept(picked); return; }
			if (event.key === 'Escape') { setClosed(true); return; }
		}
		if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown') && ownerKey) {
			event.preventDefault();
			const history = readSqlHistory(ownerKey);
			if (history.length === 0) return;
			if (historyIndex === null) stash.current = value;
			const nextIndex = event.key === 'ArrowUp'
				? (historyIndex === null ? 0 : Math.min(historyIndex + 1, history.length - 1))
				: (historyIndex === null ? history.length - 1 : historyIndex - 1);
			if (nextIndex < 0) { setHistoryIndex(null); onChange(stash.current); }
			else { setHistoryIndex(nextIndex); onChange(history[nextIndex]); }
			return;
		}
		setHistoryIndex(null);
	};
	return <div className="sql-editor">
		<div className="sql-gutter" aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index}>{index + 1}</span>)}</div>
		<textarea ref={input} value={value} disabled={disabled} spellCheck={false} aria-label="SQL editor" placeholder="SELECT …"
			onChange={event => { onChange(event.target.value); setCaret(event.target.selectionStart); setPicked(0); setClosed(false); }}
			onSelect={event => setCaret(event.currentTarget.selectionStart)}
			onKeyDown={keyDown}/>
		<Popover anchor={input} open={!closed && suggestions.length > 0} width={240} height={Math.min(200, suggestions.length * 28 + 8)} preferredSide="above" align="start" onDismiss={() => setClosed(true)} className="sql-completion">
			<ul role="listbox" aria-label="Schema completions">
				{suggestions.map((name, index) => <li key={name} role="option" aria-selected={index === picked} className={index === picked ? 'picked' : ''} onMouseDown={event => { event.preventDefault(); accept(index); }}>{name}</li>)}
			</ul>
		</Popover>
	</div>;
}
