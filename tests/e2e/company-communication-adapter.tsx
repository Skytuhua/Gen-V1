import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {CommunicationWorkspace} from '../../apps/web/src/company/CommunicationWorkspace';
import {createCommunicationFixture} from '../../apps/web/src/company/communication-fixture';

// Test-owned host adapter, not an API, sign-in or credential grant.
export function mount() {
  const host = document.createElement('div'); host.dataset.testid = 'trusted-read-test'; document.body.append(host);
  let calls = 0;
  createRoot(host).render(createElement(CommunicationWorkspace, {read: async () => {
    calls++;
    if (calls === 2) throw Object.assign(new Error('DO-NOT-RENDER-PRIVATE-ERROR'), {status: 503});
    if (calls === 3) throw Object.assign(new Error('DO-NOT-RENDER-PRIVATE-ERROR'), {status: 403});
    return {...await createCommunicationFixture(), source: 'authorized_host' as const, proofLabel: 'Synthetic host adapter test only'};
  }}));
}
