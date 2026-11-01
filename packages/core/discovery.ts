import { HarnessError } from '../contracts/index.ts';
import * as catalog from '../ui-catalog/index.ts';
import { DOMAIN_TOOLS } from '../capabilities/index.ts';
import {COMPOSITION_EXAMPLES} from '../ui-catalog/composition-examples.ts';

/** Discovery is progressive: the cheap index never repeats every data schema. */
export async function discoverCapabilities(args: Record<string, unknown>) {
  if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 200)) throw new HarnessError('INVALID_INPUT', 'Use a search query of at most 200 characters.');
  const query = String(args.query ?? '').trim().toLowerCase(), details = args.details === true || args.includeSchemas === true;
  const offset = args.offset ?? 0, limit = args.limit ?? (details ? 4 : 100);
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > (details ? 8 : 100)) throw new HarnessError('INVALID_INPUT', details ? 'Detail pages contain 1–8 entries.' : 'Index pages contain 1–100 entries.');
  const names = new Set([...catalog.CAPABILITIES, ...DOMAIN_TOOLS].map(item => item.name.toLowerCase()));
  const terms = query.split(/[\s,]+/).filter(Boolean);
  const exact = terms.length && terms.every(term => names.has(term)) ? new Set(terms) : null;
  const matches = (name: string, description: string) => exact ? exact.has(name.toLowerCase()) : !query || `${name} ${description}`.toLowerCase().includes(query);
  const components = catalog.CAPABILITIES.filter(item => matches(item.name, item.description));
  const domain = DOMAIN_TOOLS.filter(item => matches(item.name, item.description));
  const entries = [...components.map(item => ({ kind: 'component', item })), ...domain.map(item => ({ kind: 'domain', item }))];
  const page = entries.slice(Number(offset), Number(offset) + Number(limit));
  const componentPage = page.filter(item => item.kind === 'component').map(({ item }) => details ? item : { name: item.name, description: item.description.slice(0, 110) });
  const toolPage = page.filter(item => item.kind === 'domain').map(({ item }) => details ? item : { name: item.name, description: item.description.slice(0, 110) });
  const pageUses = (pack: { dataSchemas: Record<string, unknown> }) => componentPage.some(item => Object.hasOwn(pack.dataSchemas, item.name));
  const packOnPage = <T extends { dataSchemas: Record<string, unknown> }>(pack: T) => pageUses(pack) ? {
    ...pack, dataSchemas: Object.fromEntries(componentPage.filter(item => Object.hasOwn(pack.dataSchemas, item.name)).map(item => [item.name, pack.dataSchemas[item.name]])),
  } : pack;
  // Return named data contracts only when the caller explicitly asks for that family.
  const packs = details && query ? {
    ...(pageUses(catalog.SOFTWARE_DEVELOPMENT_PACK) || !exact && /software|debug|change|contract|release/.test(query) ? { softwareDevelopment: packOnPage(catalog.SOFTWARE_DEVELOPMENT_PACK) } : {}),
    ...(pageUses(catalog.EVERYDAY_PACK) || !exact && /everyday|stat|comparison/.test(query) ? { everyday: packOnPage(catalog.EVERYDAY_PACK) } : {}),
    ...(pageUses(catalog.INTERACTION_PACK) || !exact && /interaction|record|parameter/.test(query) ? { interactions: packOnPage(catalog.INTERACTION_PACK) } : {}),
    ...(pageUses(catalog.EXPLORATION_PACK) || !exact && /exploration|annotat|schedule|logexplor/.test(query) ? { exploration: packOnPage(catalog.EXPLORATION_PACK) } : {}),
    ...(pageUses(catalog.WORK_OBJECT_PACK) || !exact && /workflow|architecture|trace|work.?object/.test(query) ? { workObjects: packOnPage(catalog.WORK_OBJECT_PACK) } : {}),
  } : {};
  const compositionExamples=details?COMPOSITION_EXAMPLES.filter(example=>example.components.some(name=>componentPage.some(component=>component.name===name))).slice(0,2):[];
  return { version: catalog.CATALOG_VERSION, components: componentPage, domainTools: toolPage, total: entries.length,
    ...(compositionExamples.length?{compositionExamples}:{}),
    ...(Number(offset) + page.length < entries.length ? { nextOffset: Number(offset) + page.length } : {}), ...packs,
    detailQuery: 'Query an exact component/tool name or a comma/space-separated list of names with details:true for prop/data schemas. Detail pages use limit 1–8 and offset; keep the same query while paging.',
    presentation: { width: ['compact', 'standard', 'wide'], frame: ['card', 'canvas'], guide: 'Compose around the actual working object and decision. Inline surfaces match composer width; chat owns scrolling. Use neutral selections, stable state and artifact identity; secondary evidence belongs in inspection.' },
    planning: { tools: ['plan_update', 'task_delegate'], maxConcurrentAgents: 3, childAccess: 'read-only' },
    memory: { tool: 'task_memory', scope: 'thread', totalBytes: 4096 },
    generatedApps: { available: false, reason: 'Execution-isolation acceptance remains pending; use the trusted catalog.' },
  };
}
