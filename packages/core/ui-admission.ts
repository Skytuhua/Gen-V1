import type { Store } from '../storage/store.ts';
import { HarnessError, type ActionDefinition, type ArtifactPresentation, type ArtifactRecord, type DataBinding, type DataRecord, type InputRequest, type Operation, type ResourceGrant, type SurfaceSpec } from '../contracts/index.ts';
import { admitSchema } from './widgets.ts';
import { documentExportEvidence } from '../ui-catalog/document-export-evidence.ts';

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HarnessError('INVALID_INPUT', 'Expected an object');
  return value as Record<string, unknown>;
};

export function threadData(store: Store, threadId: string, id: string, revision?: number): DataRecord {
  const data = revision === undefined ? store.get<DataRecord>('data', id) : store.get<DataRecord>('dataVersion', `${id}@${revision}`);
  if (!data || data.threadId !== threadId) throw new HarnessError('INVALID_DATA_REF', 'Data reference is unavailable to this thread');
  return data;
}

/** Read-only admission, called inside the host's atomic artifact transaction. */
export function admitArtifactContents(store: Store, threadId: string, args: Record<string, unknown>, spec: SurfaceSpec | null, existing: ArtifactRecord | null) {
  const presentation = args.presentation === undefined ? existing?.presentation ?? { width: 'standard', frame: 'card' } : object(args.presentation);
  if (Object.keys(presentation).some(key => !['width', 'frame'].includes(key)) || !['compact', 'standard', 'wide'].includes(String(presentation.width)) || !['card', 'canvas'].includes(String(presentation.frame))) throw new HarnessError('INVALID_SPEC', 'Unknown artifact presentation');

  const bindings = args.bindings === undefined ? existing?.bindings ?? {} : object(args.bindings) as Record<string, DataBinding>;
  for (const [alias, binding] of Object.entries(bindings)) {
    let data: DataRecord;
    if (binding.mode === 'snapshot') data = threadData(store, threadId, binding.ref.id, binding.ref.revision);
    else if (binding.mode === 'live') data = threadData(store, threadId, binding.id);
    else throw new HarnessError('INVALID_DATA_REF', 'Binding mode must be snapshot or live');
    const pointer = binding.mode === 'snapshot' ? binding.ref.pointer : binding.pointer;
    if (pointer !== undefined && pointer !== '') {
      let value: unknown = data.value;
      const invalid = () => new HarnessError('INVALID_DATA_REF', `Binding ${alias.slice(0, 100)} path ${String(pointer).slice(0, 256)} is unavailable. Pointers are relative to data.value, not the enclosing record. Available root keys: ${Object.keys(data.value && typeof data.value === 'object' ? data.value : {}).slice(0, 12).join(', ') || '(none)'}`);
      if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw invalid();
      for (const token of pointer.slice(1).split('/')) {
        const key = token.replace(/~1/g, '/').replace(/~0/g, '~');
        if (['__proto__', 'prototype', 'constructor'].includes(key) || !value || typeof value !== 'object' || !Object.hasOwn(value, key)) throw invalid();
        value = (value as Record<string, unknown>)[key];
      }
    }
  }
  const sourceActions = (args.actions === undefined ? existing?.actions ?? {} : object(args.actions)) as Record<string,ActionDefinition>;
  const actions = Object.fromEntries(Object.entries(sourceActions).map(([id,action])=>{object(action);return [id,{...action}];}));
  const credentialSlots=new Set<string>();
  const checkedParents=new Set<string>();
  const inspectCredentialParents=(id:string,inForm=false)=>{const visit=id+':'+inForm;if(checkedParents.has(visit))return;checkedParents.add(visit);const node=spec?.elements[id];if(!node)return;if(node.type==='CredentialEntry'&&inForm)throw new HarnessError('INVALID_SPEC','Credential entry must be separate from action forms');for(const child of node.children??[])inspectCredentialParents(child,inForm||node.type==='Form');};
  if(spec)inspectCredentialParents(spec.root);
  for (const [nodeId, node] of Object.entries(spec?.elements ?? {})) {
    if(node.type==='CredentialEntry'){const key=String(node.props.slotKey);if(credentialSlots.has(key))throw new HarnessError('INVALID_SPEC','Credential slots must have unique keys');credentialSlots.add(key);}
    for (const resourceKey of ['resourceId', 'beforeResourceId', 'afterResourceId']) if (typeof node.props[resourceKey] === 'string') {
      const resource = store.get<ResourceGrant>('resource', node.props[resourceKey] as string);
      if (!resource || resource.threadId !== threadId) throw new HarnessError('CAPABILITY_DENIED', 'Component resource is not granted to this thread');
    }
    if (node.type === 'DocumentPreview' && typeof node.props.exportOperationId === 'string') {
      const operation = store.get<Operation>('operation', node.props.exportOperationId);
      const old = existing?.spec?.elements[nodeId];
      try {
        const ids = operation ? operation.resourceIds : [];
        documentExportEvidence(threadId, node.props.exportOperationId, operation ? [operation] : [], ids.map(id => store.get<ResourceGrant>('resource', id)).filter((grant): grant is ResourceGrant => Boolean(grant)), { resourceId: String(node.props.resourceId), resourcePath: node.props.resourcePath as string | undefined }, old?.type === 'DocumentPreview' ? { resourceId: String(old.props.resourceId), resourcePath: old.props.resourcePath as string | undefined } : undefined);
      } catch { throw new HarnessError('CAPABILITY_DENIED', 'Completed PDF export is not available for this preview'); }
    }
    for (const key of ['actionId', 'onOpenActionId', 'feedbackActionId']) if (typeof node.props[key] === 'string' && !Object.hasOwn(actions, node.props[key])) throw new HarnessError('INVALID_SPEC', 'Component references an undeclared action');
    for (const key of ['rowsBinding', 'dataBinding', 'changesBinding']) if (typeof node.props[key] === 'string' && !Object.hasOwn(bindings, node.props[key] as string)) throw new HarnessError('INVALID_DATA_REF', 'Component references an undeclared binding');
    if (node.type === 'Progress' && node.props.value !== undefined && !node.props.dataBinding) throw new HarnessError('INVALID_DATA_REF', 'Numerical progress must bind executor-owned data');
  }
  for (const action of Object.values(actions)) {
    if (!['agent', 'operation', 'request'].includes(action.kind)) throw new HarnessError('INVALID_SPEC', 'Unknown action route');
    if (action.schema) admitSchema(action.schema);
    if (action.kind === 'operation') {
      const operation = store.get<Operation>('operation', action.operationId ?? '');
      if (!operation || operation.threadId !== threadId) throw new HarnessError('CAPABILITY_DENIED', 'Action operation is not available');
    }
    if (action.kind === 'request') {
      const request = store.get<InputRequest>('request', action.requestId ?? '');
      if (!request || request.threadId !== threadId) throw new HarnessError('CAPABILITY_DENIED', 'Action request is not available');
      if(args.actions!==undefined||!existing){
        if(action.requestRevision!==undefined&&action.requestRevision!==request.revision)throw new HarnessError('STALE_REQUEST','Refresh the decision before publishing this action');
        action.requestRevision=request.revision;
      }
    }
  }
  return { presentation: presentation as unknown as ArtifactPresentation, bindings, actions };
}
