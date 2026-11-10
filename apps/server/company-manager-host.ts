import {createCompanyManagerTools, type CompanyClient} from '../../packages/company-client/index.ts';
import {join} from 'node:path';
import {lstatSync, mkdirSync, realpathSync} from 'node:fs';
import {Store} from '../../packages/storage/store.ts';
import {CompanyManagerJournal} from '../../packages/company-manager/journal.ts';
import type {RuntimeAccountResolver} from '../../packages/contracts/accounts.ts';
import {CompanyManagerError, type CompanyManagerBootstrap} from '../../packages/company-manager/contracts.ts';
import {createCompanyManagerRuntime, type CompanyManagerRuntimeDependencies} from '../../packages/company-manager/runtime.ts';
import {launchCompanyHost, type CompanyHostOptions} from './company-mode.ts';

/** Supplied only by trusted host code after real Maritime authority checks. */
export interface CompanyManagerHostAuthority {
  bootstrap: CompanyManagerBootstrap;
  employeeClient: CompanyClient<'employee'>;
  accounts: RuntimeAccountResolver;
}

function managerPaths(dataDir: string) {
  const paths = {journal: join(dataDir, 'manager-ui'), runtime: join(dataDir, 'manager-runtime'), home: join(dataDir, 'manager-home')};
  try {
    for (const path of Object.values(paths)) {
      try {mkdirSync(path);} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;}
      const info = lstatSync(path);
      if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(path) !== path) throw new Error();
    }
    try {
      const info = lstatSync(join(paths.journal, 'harness.sqlite'));
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error();
    } catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
    return paths;
  } catch {throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');}
}

export async function launchCompanyManagerHost(options: Omit<CompanyHostOptions, 'manager'>, authority?: CompanyManagerHostAuthority, dependencies: CompanyManagerRuntimeDependencies = {}) {
  if (!authority) return launchCompanyHost(options);
  if (options.client?.role !== 'owner' || authority.employeeClient?.role !== 'employee' ||
      typeof authority.bootstrap?.authorize !== 'function' || typeof authority.bootstrap.assertCurrent !== 'function' || typeof authority.accounts?.get !== 'function') throw new CompanyManagerError('COMPANY_MANAGER_BLOCKED');
  const tools = createCompanyManagerTools(authority.employeeClient);
  return launchCompanyHost(options, async dataDir => {
    const paths = managerPaths(dataDir);
    // Existing Gen interaction storage only: never the Maritime company Store,
    // personal account/session storage, a scheduler or an operational ledger.
    const store = new Store(paths.journal);
    let runtime: ReturnType<typeof createCompanyManagerRuntime> | undefined;
    try {
      runtime = createCompanyManagerRuntime({dataDir: paths.runtime, home: paths.home,
        accounts: authority.accounts, tools, bootstrap: authority.bootstrap}, dependencies);
      const manager = new CompanyManagerJournal(store, runtime);
      let closing: Promise<void> | undefined;
      return {manager, close: () => closing ??= manager.dispose().then(() => store.close())};
    } catch (error) {
      try {await runtime?.dispose();} catch {throw new CompanyManagerError('COMPANY_MANAGER_CLEANUP');}
      store.close(); throw error;
    }
  });
}
