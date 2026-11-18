import { z } from 'zod';
import { relativePath } from '../capabilities/schemas.ts';

export const repositoryMapArgs = z.strictObject({
  resourceId: z.string().min(1).max(200),
  paths: z.array(relativePath).min(1).max(8).optional(),
  focusPaths: z.array(relativePath).max(8).optional(),
  symbols: z.array(z.string().min(1).max(256)).max(32).optional(),
});
export const REPOSITORY_MAP = {
  name: 'repository_map',
  description: 'Map at most eight explicitly named granted files to declared import edges and exact exported symbol lines, without reading full files into the request. A project grant requires paths; an exact file grant omits paths. No directory crawl. Unsupported languages return FILE_LIST_ONLY. Content hashes bind the captured version; this map grants no execution permission.',
  parameters: z.toJSONSchema(repositoryMapArgs) as Record<string, unknown>,
};
