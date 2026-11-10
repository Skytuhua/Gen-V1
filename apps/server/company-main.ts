import {runCompanyHost} from './company-lifecycle.ts';
import {launchCompanyHost, readCompanyHostOptions} from './company-mode.ts';

await runCompanyHost(() => launchCompanyHost(readCompanyHostOptions()));
