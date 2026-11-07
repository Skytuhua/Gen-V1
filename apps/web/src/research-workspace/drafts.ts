import type {ResearchDocument, ResearchPassage} from '../../../../packages/contracts/research';
import {researchScope, type ResearchSelection} from './client';

export interface ResearchDraft {
  id: string; title: string; kind: ResearchDocument['kind']; body: string; citations: ResearchPassage[];
  expectedRevision: number; dirty: boolean; edit: number; conflict?: ResearchDocument;
}
export class ResearchDrafts {
  private records = new Map<string, ResearchDraft>();
  private attempts = new Map<string, {commandId: string; sent: ResearchDraft}>();
  private key(selection: ResearchSelection, id: string) {return researchScope(selection) + ':' + id;}
  get(selection: ResearchSelection, id: string) {return this.records.get(this.key(selection, id));}
  all(selection: ResearchSelection) {const prefix = researchScope(selection) + ':'; return [...this.records].filter(([key]) => key.startsWith(prefix)).map(([, draft]) => draft);}
  create(selection: ResearchSelection, kind: ResearchDocument['kind']): ResearchDraft {
    const draft = {id: crypto.randomUUID(), title: kind === 'findings' ? 'Untitled findings' : 'Working notes', kind, body: '', citations: [], expectedRevision: 0, dirty: true, edit: 0};
    this.records.set(this.key(selection, draft.id), draft); return draft;
  }
  open(selection: ResearchSelection, document: ResearchDocument): ResearchDraft {
    const key = this.key(selection, document.id), existing = this.records.get(key);
    if (existing?.dirty) {
      if (existing.expectedRevision !== document.revision && !this.attempts.has(key + ':write')) existing.conflict = document;
      return existing;
    }
    const draft = {...document, citations: document.citations.map(({sourceId, revision, sha256, start, end}) => ({sourceId, revision, sha256, start, end})), expectedRevision: document.revision, dirty: false, edit: existing?.edit ?? 0};
    this.records.set(key, draft); return draft;
  }
  edit(selection: ResearchSelection, id: string, patch: Partial<Pick<ResearchDraft, 'body' | 'title' | 'citations'>>) {
    const draft = this.get(selection, id);
    if (!draft) throw Error('Open the research document before editing.');
    const next = {...draft, ...patch, dirty: true, edit: draft.edit + 1};
    this.records.set(this.key(selection, id), next); return next;
  }
  beginSave(selection: ResearchSelection, id: string, copy = false) {
    const key = this.key(selection, id) + (copy ? ':copy' : ':write');
    if (!this.attempts.has(key)) {
      const draft = this.get(selection, id); if (!draft) throw Error('Open the research document before saving.');
      this.attempts.set(key, {commandId: crypto.randomUUID(), sent: {...draft, ...(copy ? {id: crypto.randomUUID(), expectedRevision: 0} : {}), title: draft.title.trim(), citations: draft.citations.map(ref => ({...ref}))}});
    }
    return this.attempts.get(key)!;
  }
  finishSave(selection: ResearchSelection, id: string, attempt: {commandId: string}, copy = false, saved?: {revision: number; sha256: string}) {
    const key = this.key(selection, id) + (copy ? ':copy' : ':write');
    const active = this.attempts.get(key);
    if (active?.commandId !== attempt.commandId) return false;
    // A receipt may arrive from multiple mounted editors; only its current owner can reconcile it.
    this.attempts.delete(key);
    if (saved) {
      const sent = active.sent, current = this.get(selection, sent.id) ?? sent;
      if (current.expectedRevision > sent.expectedRevision) return false;
      this.records.set(this.key(selection, sent.id), {...current, expectedRevision: saved.revision, dirty: current.edit !== sent.edit, conflict: undefined});
    }
    return true;
  }
}
// Remounting a workspace preserves unsaved drafts without placing source material in browser storage.
export const researchDrafts = new ResearchDrafts();
