import {runCompanyHost} from './company-lifecycle.ts';
import {launchCompanyManagerHost} from './company-manager-host.ts';
import {readCompanyHostOptions} from './company-mode.ts';

// No real admission/account/accounting producer is installed. No authority is
// obtained from environment or browser input; the manager stays unavailable.
await runCompanyHost(() => launchCompanyManagerHost(readCompanyHostOptions()));
