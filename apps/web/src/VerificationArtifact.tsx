import {useEffect, useState} from 'react';
import {authenticated} from './api';

export const isRetainedVerificationArtifact = (ref: string) => /^verification-artifact:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(ref);
type ArtifactState = {status: 'loading'} | {status: 'unavailable'} | {status: 'log'; text: string; truncated: boolean} | {status: 'image'; url: string; width: number; height: number};

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const length = response.headers.get('content-length') ?? '';
  const size = Number(length);
  if (!/^(0|[1-9]\d*)$/.test(length) || !Number.isSafeInteger(size) || size > limit) throw Error('Artifact response exceeds its bound');
  const bytes = new Uint8Array(size), reader = response.body?.getReader();
  if (!reader) {if (size) throw Error('Artifact response is incomplete'); return bytes;}
  let offset = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (offset + result.value.length > size) {await reader.cancel(); throw Error('Artifact response exceeds its bound');}
      bytes.set(result.value, offset); offset += result.value.length;
    }
  } finally {reader.releaseLock();}
  if (offset !== size) throw Error('Artifact response is incomplete');
  return bytes;
}

/** Loads one retained item at a time through the authenticated host reader.
 * References never become paths or external URLs; logs remain inert text. */
export function VerificationArtifact({threadId, artifactRef}: {threadId: string; artifactRef: string}) {
  const [state, setState] = useState<ArtifactState>({status: 'loading'});
  useEffect(() => {
    const controller = new AbortController(); let imageUrl: string | undefined;
    const load = async () => {
      try {
        if (!isRetainedVerificationArtifact(artifactRef)) throw Error('Unknown retained reference');
        const id = artifactRef.slice('verification-artifact:'.length);
        const response = await authenticated(() => fetch(`/api/threads/${encodeURIComponent(threadId)}/verification/artifacts/${id}`, {credentials: 'same-origin', cache: 'no-store', signal: controller.signal}));
        if (!response.ok) throw Error('Retained artifact unavailable');
        const mime = response.headers.get('content-type');
        if (mime !== 'image/png' && mime !== 'text/plain; charset=utf-8') throw Error('Unsupported retained artifact');
        const bytes = await boundedBytes(response, mime === 'image/png' ? 8 * 1024 * 1024 : 64 * 1024);
        if (controller.signal.aborted) return;
        if (mime === 'image/png') {
          const width = Number(response.headers.get('x-verification-viewport-width')), height = Number(response.headers.get('x-verification-viewport-height'));
          if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_777_216) throw Error('Invalid captured viewport');
          imageUrl = URL.createObjectURL(new Blob([bytes], {type: 'image/png'}));
          setState({status: 'image', url: imageUrl, width, height});
        } else setState({status: 'log', text: new TextDecoder('utf-8', {fatal: true}).decode(bytes), truncated: response.headers.get('x-verification-artifact-truncated') === 'true'});
      } catch {if (!controller.signal.aborted) setState({status: 'unavailable'});}
    };
    setState({status: 'loading'}); void load();
    return () => {controller.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl);};
  }, [threadId, artifactRef]);
  if (state.status === 'loading') return <p role="status">Loading retained artifact.</p>;
  if (state.status === 'unavailable') return <p role="status">Retained artifact unavailable.</p>;
  if (state.status === 'log') return <div className="verification-retained-artifact">{state.truncated && <p>Log truncated at capture.</p>}<pre aria-label="Retained log" tabIndex={0}>{state.text || '(empty log)'}</pre></div>;
  return <figure className="verification-retained-artifact"><figcaption>Captured at {state.width} × {state.height}</figcaption><img src={state.url} width={state.width} height={state.height} alt="Captured verification screenshot" onError={() => setState({status: 'unavailable'})} /></figure>;
}
