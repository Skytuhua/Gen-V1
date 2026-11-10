import golden from '../../../../packages/company-contracts/communications/v1/golden/employee-received.json';
import {canonicalBytes} from '../../../../packages/company-contracts/communications/json';
import {prepareEmployeeReceivedCommand, validateEmployeeDeliveryReceipt, type EmployeeReceivedContext} from '../../../../packages/company-contracts/communications/employee-received';
import {projectCommunicationRecords, type CommunicationReadModel} from './communication-model';

/** Explicit Stage 1 fixture; never substituted for a failed authorized read. */
export async function createCommunicationFixture(): Promise<CommunicationReadModel> {
  const example = golden.example;
  const context: EmployeeReceivedContext = {company_id: 'leo-company', scope: {kind: 'project', id: 'alpha'},
    machine_principal_id: 'machine:E11', journal_owner_id: 'supervisor-E11',
    recipient: example.envelope.delivery.recipient as EmployeeReceivedContext['recipient']};
  const prepared = await prepareEmployeeReceivedCommand(canonicalBytes(example.command), context, canonicalBytes(example.envelope));
  const receipt = await validateEmployeeDeliveryReceipt(canonicalBytes(example.receipt), context, prepared);
  const model = projectCommunicationRecords('leo-company', 'alpha', [prepared.envelope], [receipt], 'synthetic_fixture');
  return Object.freeze({...model, projectName: 'Alpha',
    tasks: Object.freeze(model.tasks.map(task => Object.freeze({...task, title: 'Inspect the backend handoff'}))),
    blockers: Object.freeze(['Illustrative wait reason: waiting for an eligible task slot. No inference is running.',
      'Live company pilot and owner-authorized communication adapter are unavailable in this workspace.']),
    decision: Object.freeze({title: 'Illustrative owner decision: clarify the next handoff', status: 'unavailable' as const,
      detail: 'Fixture-only decision placeholder. No accepted decision, decider, delegation or evidence record is available.',
      acceptedDecision: null, decider: null, evidence: Object.freeze([]) as readonly []}),
  });
}
