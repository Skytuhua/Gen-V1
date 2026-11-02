import { createContext, useContext } from 'react';
import type { Operation, ResourceGrant } from '../../../packages/contracts';

export type DocumentHandoffState = 'pending' | 'ready' | 'error';
export type DocumentEvidence = { threadId: string; operations: Operation[]; resources: ResourceGrant[]; onHandoffState?: (operationId: string, state: DocumentHandoffState) => void };
const Context = createContext<DocumentEvidence | null>(null);
export const DocumentEvidenceProvider = Context.Provider;
export const useDocumentEvidence = () => useContext(Context);
