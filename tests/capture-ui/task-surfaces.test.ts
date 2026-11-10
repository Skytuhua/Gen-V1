import {describe, expect, it} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {validateSurface} from '../../packages/ui-catalog';
import {INTERACTION_DATA_SCHEMAS} from '../../packages/ui-catalog/interactions';
import {EVERYDAY_DATA_SCHEMAS} from '../../packages/ui-catalog/everyday';
import {EXPLORATION_DATA_SCHEMAS} from '../../packages/ui-catalog/exploration';
import {SOFTWARE_DATA_SCHEMAS} from '../../packages/ui-catalog/software-development';
import {WORK_OBJECT_DATA_SCHEMAS} from '../../packages/ui-catalog/work-objects';
import {validateSignaturePng} from '../../packages/ui-catalog/signature-data';
import {tableChangesData} from '../../packages/ui-catalog/workflow';
import {createTaskSnapshot, TASK_RESOURCE_IDS, TASK_SURFACES, taskSurfaceFixtures} from '../../scripts/capture-ui/task-data';
import {taskAssetResponse} from '../../scripts/capture-ui/task-assets';

describe('task renderer capture sources', () => {
  it.each(TASK_SURFACES)('%s has a valid, connected catalog spec with matching grants and input bindings', surface => {
    const snapshot = createTaskSnapshot(surface), artifact = snapshot.artifacts[0], spec = artifact.spec!;
    expect(() => validateSurface(spec)).not.toThrow();
    const visited = new Set<string>();
    const visit = (id: string) => {if (visited.has(id)) return; visited.add(id); expect(spec.elements[id]).toBeDefined(); spec.elements[id].children?.forEach(visit);};
    visit(spec.root); expect(visited.size).toBe(Object.keys(spec.elements).length);
    for (const element of Object.values(spec.elements)) {
      for (const key of ['dataBinding', 'rowsBinding', 'changesBinding']) {
        if (typeof element.props[key] === 'string') expect(artifact.bindings[element.props[key] as string]).toBeDefined();
      }
      for (const key of ['resourceId', 'beforeResourceId', 'afterResourceId']) {
        if (typeof element.props[key] === 'string') expect(snapshot.resources.some(grant => grant.id === element.props[key] && grant.threadId === artifact.threadId)).toBe(true);
      }
    }
  });
  it('all source-bound inspectors receive datasets accepted by their real schemas', () => {
    const inputs = (name: typeof TASK_SURFACES[number]) => taskSurfaceFixtures[name].inputs;
    for (const [name, schema] of Object.entries(WORK_OBJECT_DATA_SCHEMAS)) expect(schema.safeParse(inputs('work-objects')[name]).success, name).toBe(true);
    for (const [name, schema] of Object.entries(SOFTWARE_DATA_SCHEMAS)) expect(schema.safeParse(inputs('software')[name]).success, name).toBe(true);
    for (const [name, key] of [['ReviewQueue', 'review'], ['EditableTable', 'records'], ['ParameterControls', 'parameters']] as const) expect(INTERACTION_DATA_SCHEMAS[name].safeParse(inputs('interactions')[key]).success, name).toBe(true);
    expect(EVERYDAY_DATA_SCHEMAS.Stats.safeParse(inputs('everyday').stats).success).toBe(true);
    expect(EVERYDAY_DATA_SCHEMAS.Comparison.safeParse(inputs('everyday').comparison).success).toBe(true);
    expect(EXPLORATION_DATA_SCHEMAS.SchedulePicker.safeParse(inputs('exploration').schedule).success).toBe(true);
    expect(EXPLORATION_DATA_SCHEMAS.LogExplorer.safeParse(inputs('exploration').logs).success).toBe(true);
    expect(tableChangesData.safeParse(inputs('table-disclosure').changes).success).toBe(true);
  });
  it('isolates mutable capture state from shared source fixtures', () => {
    const first = createTaskSnapshot('document'), next = createTaskSnapshot('document');
    first.userStates[0].values.name = 'Changed'; first.artifacts[0].spec!.elements.pdf.props.title = 'Changed';
    expect(next.userStates[0].values.name).toBe('Alex Morgan');
    expect(next.artifacts[0].spec!.elements.pdf.props.title).toBe('Synthetic service agreement.pdf');
  });
  it('keeps empty source variants schema-valid without mutating the populated fixtures', () => {
    const data = (surface: typeof TASK_SURFACES[number], name: string) => createTaskSnapshot(surface, true).data.find(row => row.id.endsWith(`-input-${name}`))!.value;
    expect(INTERACTION_DATA_SCHEMAS.EditableTable.parse(data('interactions', 'records')).rows).toEqual([]);
    expect(INTERACTION_DATA_SCHEMAS.ReviewQueue.safeParse(data('interactions', 'review')).success).toBe(true);
    for (const [name, schema] of Object.entries(WORK_OBJECT_DATA_SCHEMAS)) expect(schema.safeParse(data('work-objects', name)).success, name).toBe(true);
    for (const [name, schema] of Object.entries(SOFTWARE_DATA_SCHEMAS)) expect(schema.safeParse(data('software', name)).success, name).toBe(true);
    expect(EXPLORATION_DATA_SCHEMAS.SchedulePicker.parse(data('exploration', 'schedule')).slots).toEqual([]);
    expect(EXPLORATION_DATA_SCHEMAS.LogExplorer.parse(data('exploration', 'logs')).events).toEqual([]);
    expect(EVERYDAY_DATA_SCHEMAS.Comparison.safeParse(data('everyday', 'comparison')).success).toBe(true);
    expect(createTaskSnapshot('table-disclosure', true).data.find(row => row.id.endsWith('-input-rows'))?.value).toEqual([]);
    expect(createTaskSnapshot('interactions').data.find(row => row.id.endsWith('-input-records'))?.value).not.toEqual(data('interactions', 'records'));
  });
  it('supplies a bounded real PDF and a valid transparent signature PNG', async () => {
    const pdf = await taskAssetResponse(TASK_RESOURCE_IDS.pdf), signature = await taskAssetResponse(TASK_RESOURCE_IDS.signature);
    const document = await PDFDocument.load(pdf!.body as Uint8Array);
    expect(document.getPageCount()).toBe(1);
    expect(document.getForm().getTextField('Name').getText()).toBe('John Doe');
    expect(() => validateSignaturePng(signature!.body as Uint8Array, true)).not.toThrow();
    expect(await taskAssetResponse('unregistered-resource')).toBeNull();
  });
});
