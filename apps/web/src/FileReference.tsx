import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { FileReference } from './file-references';
import { createFileReferenceVerifier, useFileReferenceStatus, type FileReferenceOwner, type FileReferenceVerifier } from './file-reference-verifier';

export interface FileReferenceContextValue {
  owner: FileReferenceOwner;
  verifier: FileReferenceVerifier;
  open: (ref: FileReference) => void;
}
export const FileReferenceContext = createContext<FileReferenceContextValue | null>(null);

/** One verifier per conversation owner; detection in the wrapped assistant replies only. */
export function FileReferenceProvider({ owner, open, children }: { owner: FileReferenceOwner; open: (ref: FileReference) => void; children: ReactNode }) {
  const value = useMemo<FileReferenceContextValue>(() => ({ owner, verifier: createFileReferenceVerifier(owner), open }), [owner.projectId, owner.threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => value.verifier.dispose(), [value]);
  return <FileReferenceContext.Provider value={value}>{children}</FileReferenceContext.Provider>;
}

export function FileReferenceNode({ reference, raw, code }: { reference: FileReference; raw: string; code?: boolean }) {
  const context = useContext(FileReferenceContext);
  const [status, element] = useFileReferenceStatus(reference.path, context?.verifier ?? null);
  const baseline = code ? <code>{raw}</code> : <>{raw}</>;
  if (!context || status === 'absent') return baseline;
  // A span wraps the pre-verification node so the viewport observer has a DOM target.
  if (status === 'unknown') return <span ref={element}>{baseline}</span>;
  const label = reference.line ? `Open ${reference.path} at line ${reference.line} in Files` : `Open ${reference.path} in Files`;
  return <button type="button" ref={element as React.RefObject<HTMLButtonElement>} className={code ? 'markdown-file-ref markdown-file-ref-code' : 'markdown-file-ref'} aria-label={label} title={label}
    onClick={event => { if (event.button === 0) { event.preventDefault(); context.open(reference); } }}
    onAuxClick={event => { if (event.button === 1) { event.preventDefault(); context.open(reference); } }}>
    {code ? <code>{raw}</code> : raw}
  </button>;
}
