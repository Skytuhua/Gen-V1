import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JSONUIProvider, Renderer, useStateStore} from '@json-render/react';
import {registry, SchemaFields, schemaDefaults} from '../../apps/web/src/registry';
import '../../apps/web/src/styles.css';

function CatalogState() {
  const store = useStateStore();
  return <output aria-label="Catalog state">{JSON.stringify(store.state.values)}</output>;
}
function Fixture() {
  const review = new URLSearchParams(location.search).get('review');
  const [disabled, setDisabled] = useState(false), [submitted, setSubmitted] = useState('');
  const overflow = new URLSearchParams(location.search).has('overflow');
  const reviewField: Record<string, unknown> = review === 'empty' ? {type: 'string', enum: ['a', 'b']} : ['false','optional-false'].includes(review ?? '') ? {type: 'boolean', enum: [true]} : review === 'array-order' ? {type: 'array', enum: [[1, 2]]} : review === 'array-restored' ? {type: 'array', enum: [[{a: 1, b: 2}]]} : {type: 'object', enum: [{a: 1, b: 2}], ...(review === 'object-default' ? {default: {b: 2, a: 1}} : {})};
  const schema = review ? {type: 'object', required: review === 'optional-false' ? [] : ['required'], properties: {required: {title: review === 'optional-false' ? 'Optional choice' : 'Required choice', ...reviewField}}} : {type: 'object', required: ['required'], properties: {
    required: {title: 'Required choice', enum: [false, null, 0, '0', {id: 1}, [1, false]]},
    optional: {title: 'Optional choice', enum: [false, null, 0, '0', {id: 1}, [1, false]]},
    object: {title: 'Object choice', type: 'object', enum: [{id: 1}, {id: 2}]},
    array: {title: 'Array choice', type: 'array', enum: [[1, false], [2, null]]},
    boolean: {title: 'Boolean choice', type: 'boolean', enum: [false, true]},
    nested: {title: 'Nested', type: 'object', properties: {choice: {title: 'Nested choice', enum: ['a', 'b']}}},
  }};
  const [values, setValues] = useState<Record<string, unknown>>(() => !review ? {} : review === 'empty' ? {required: ''} : review === 'object-restored' ? {required: {b: 2, a: 1}} : review === 'array-restored' ? {required: [{b: 2, a: 1}]} : review === 'array-order' ? {required: [2, 1]} : schemaDefaults(schema) as Record<string, unknown>);
  return <main style={{padding: 16, maxWidth: 600}}>
    <p>Synthetic generated Select adoption fixture</p>
    <label>Neighboring draft<input defaultValue="Keep this draft"/></label>
    <div role="textbox" aria-label="Neighboring editor" contentEditable suppressContentEditableWarning>Keep this editor</div>
    <label><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)}/>Disable fields</label>
    <fieldset disabled={disabled}>
      <JSONUIProvider registry={registry} initialState={{values: {catalog: 'one'}}}>
        <Renderer registry={registry} spec={{root: 'catalog', elements: {catalog: {type: 'Select', props: {stateKey: 'catalog', label: 'Catalog choice', options: overflow ? Array.from({length: 80}, (_, index) => ({value: `choice-${index}`, label: `Choice ${index + 1} with a long supplied label`})) : [{value: 'one', label: 'One'}, {value: 'two', label: 'Two'}, {value: 'false', label: 'False string'}]}}}}}/>
        <CatalogState/>
      </JSONUIProvider>
      <form aria-label="Enum form" onSubmit={event => {event.preventDefault(); setSubmitted(JSON.stringify(values));}}>
        <SchemaFields schema={schema} value={values} onChange={setValues}/>
        <button type="submit">Submit enums</button>
      </form>
    </fieldset>
    <output aria-label="Enum state">{JSON.stringify(values)}</output>
    <output aria-label="Submitted enums">{submitted}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
