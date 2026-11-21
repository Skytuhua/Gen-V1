import { useMemo, useState } from 'react';
import { ChevronRight, Eye, Key, Link, ListOrdered, Table2 } from 'lucide-react';
import type { DatabaseSchemaV1 } from '../../../../packages/contracts/database.ts';

type SchemaObject = DatabaseSchemaV1['schemas'][number]['objects'][number];

const compactRows = (value: number | null) => value === null ? '' : value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(value);
const badge = (column: SchemaObject['columns'][number], object: SchemaObject) => column.primaryKey ? <Key size={12} aria-label="Primary key"/> :
	object.foreignKeys.some(fk => fk.columns.includes(column.name)) ? <Link size={12} aria-label="Foreign key"/> : null;

function ObjectNode({ schemaName, object, selected, onSelect }: { schemaName: string; object: SchemaObject; selected: boolean; onSelect: (schema: string, name: string) => void }) {
	const [open, setOpen] = useState(false);
	return <div className="schema-object">
		<button type="button" className={`schema-tree-row${selected ? ' selected' : ''}`} aria-expanded={open} onClick={() => { setOpen(value => !value); onSelect(schemaName, object.name); }}>
			<ChevronRight size={14} className="schema-chevron"/>
			{object.kind === 'view' ? <Eye size={14}/> : <Table2 size={14}/>}
			<span className="schema-name">{object.name}</span>
			<span className="schema-count">{compactRows(object.approxRows)}</span>
		</button>
		{open && <div className="schema-children">
			{object.columns.map(column => <div className="schema-tree-row schema-column" key={column.name}>
				{badge(column, object)}
				<span className="schema-name">{column.name}</span>
				<span className="schema-type">{column.type}</span>
			</div>)}
			{object.indexes.map(index => <div className="schema-tree-row schema-column" key={index.name}>
				<ListOrdered size={12}/>
				<span className="schema-name">{index.name}</span>
				<span className="schema-type">{index.unique ? 'unique' : ''} ({index.columns.join(', ')})</span>
			</div>)}
		</div>}
	</div>;
}

export function SchemaTree({ schema, filter, selected, onSelect }: { schema: DatabaseSchemaV1; filter: string; selected?: string; onSelect: (schema: string, name: string) => void }) {
	const [openSchemas, setOpenSchemas] = useState<Record<string, boolean>>({});
	const needle = filter.trim().toLowerCase();
	const filtered = useMemo(() => schema.schemas.map(entry => ({
		name: entry.name,
		objects: entry.objects.filter(object => !needle || object.name.toLowerCase().includes(needle) || object.columns.some(column => column.name.toLowerCase().includes(needle))),
	})).filter(entry => entry.objects.length > 0), [schema, needle]);
	const total = filtered.reduce((count, entry) => count + entry.objects.length, 0);
	if (total === 0) return <p className="schema-empty muted">{schema.schemas.every(entry => entry.objects.length === 0) ? 'No tables in this database' : 'No matching tables'}</p>;
	return <div className="schema-tree">
		{filtered.map(entry => {
			const open = needle ? true : openSchemas[entry.name] !== false;
			return <div className="schema-group" key={entry.name}>
				<button type="button" className="schema-tree-row schema-group-row" aria-expanded={open} onClick={() => setOpenSchemas(state => ({ ...state, [entry.name]: !(state[entry.name] !== false) }))}>
					<ChevronRight size={14} className="schema-chevron"/>
					<span className="schema-name">{entry.name}</span>
					<span className="schema-count">{entry.objects.length}</span>
				</button>
				{open && <div className="schema-children">
					{entry.objects.map(object => <ObjectNode key={object.name} schemaName={entry.name} object={object} selected={selected === `${entry.name}.${object.name}`} onSelect={onSelect}/>)}
				</div>}
			</div>;
		})}
	</div>;
}
