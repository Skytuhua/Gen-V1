import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { FileReference } from './file-references';
import { createFileReferenceVerifier, useFileReferenceStatus, type FileReferenceOwner, type FileReferenceVerifier } from './file-reference-verifier';

export interface FileReferenceContextValue {
  owner: FileReferenceOwner;
  verifier: FileReferenceVerifier;
  open: (ref: FileReference) => void;
}
export const FileReferenceContext = createContext<FileReferenceContextValue | null>(null);

/** One verifier per conversation owner; mount once per transcript, then share. */
export function useFileReferenceContext(owner: FileReferenceOwner | null, open: (ref: FileReference) => void): FileReferenceContextValue | null {
  const openRef = useRef(open);
  openRef.current = open;
  const value = useMemo<FileReferenceContextValue | null>(() => owner ? { owner, verifier: createFileReferenceVerifier(owner), open: ref => openRef.current(ref) } : null, [owner?.projectId, owner?.threadId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => value?.verifier.dispose(), [value]);
  return value;
}

export function FileReferenceProvider({ value, children }: { value: FileReferenceContextValue | null; children: ReactNode }) {
  if (!value) return <>{children}</>;
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
