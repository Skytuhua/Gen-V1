import {HarnessError} from '../contracts/index.ts';
import {
 WORKER_PROTOCOL_VERSION,pluginMigrationPlanV1Schema,pluginManifestV2Schema,isolatedDeclarationSchema,
 type IsolatedDeclaration,type PluginManifestV2,
} from '../contracts/plugin-worker.ts';
import {verifyPluginPackage,type VerifiedPackage} from './installation.ts';

// M13 package admission and lifecycle decisions. The isolated lane admits only
// an already installed, pinned package directory verified by the existing
// installer owner — never an archive upload, an implicit install script, a
// network download or an unresolved dependency. A package opts into the lane
// by shipping a declared isolated.json; the host binds the verified inventory
// digest and protocol version, never the declaration alone.

/** Package-relative path of the optional declaration that opts a package into
 * the isolated extension lane. */
export const ISOLATED_DECLARATION_PATH='isolated.json';

/** A package admitted to the isolated lane: the V2 manifest derived from its
 * declaration (bound to the verified digest and worker protocol version) plus
 * the verified trusted package itself. */
export interface AdmittedIsolatedPackage{manifest:PluginManifestV2;verified:VerifiedPackage}

/** Verify the pinned package and read its optional isolated-lane declaration.
 * Returns null for packages that only run trusted; throws on integrity,
 * identity or declaration violations. */
export async function admitIsolatedPackage(directory:string,expectedDigest:string):Promise<AdmittedIsolatedPackage|null>{
 const verified=await verifyPluginPackage(directory,expectedDigest);
 const bytes=verified.files.get(ISOLATED_DECLARATION_PATH);
 if(!bytes)return null;
 let declaration:IsolatedDeclaration;
 try{declaration=isolatedDeclarationSchema.parse(JSON.parse(bytes.toString('utf8')));}catch{throw new HarnessError('INVALID_INPUT','The isolated extension declaration is malformed.');}
 // The declaration must name exactly the verified trusted manifest it rides
 // with; a mismatched identity never borrows the package's trust.
 if(declaration.pluginId!==verified.manifest.id||declaration.version!==verified.manifest.version)throw new HarnessError('INVALID_INPUT','The isolated extension declaration does not match the verified plug-in.');
 const manifest=pluginManifestV2Schema.parse({...declaration,packageDigest:verified.digest,protocolVersion:WORKER_PROTOCOL_VERSION});
 return {manifest,verified};
}

/* ------------------------------------------------------------------ */
/* Migration gate (M13-S07). A migration-needing update proceeds only   */
/* with a complete pre-existing approved contract: approved plan id,     */
/* immutable input/output versions matching the installed and next       */
/* manifests, a backup digest, the exact migration executable digest and */
/* a post-validation receipt. Anything less is MIGRATION_PLAN_REQUIRED,  */
/* a blocked update — never an ad hoc migration and never a dropped      */
/* namespace. The plan is only validated here; it executes solely        */
/* through the proven backend, never with host privileges.               */
/* ------------------------------------------------------------------ */

/** Whether an update may proceed: `READY`, or `MIGRATION_PLAN_REQUIRED` with
 * the reason — a blocked update, never an ad hoc migration. */
export type MigrationDecision={status:'READY'}|{status:'MIGRATION_PLAN_REQUIRED';reason:string};

/** Gate a data-migrating update on a complete pre-existing migration contract.
 * The plan must parse as `pluginMigrationPlanV1Schema` and its input/output
 * versions must exactly match the installed and next manifests. Any missing,
 * malformed or version-mismatched plan yields `MIGRATION_PLAN_REQUIRED`.
 * Validation only — the plan executes solely through the proven backend. */
export function evaluateMigrationPlan(current:PluginManifestV2,next:PluginManifestV2,plan:unknown):MigrationDecision{
 const parsed=pluginMigrationPlanV1Schema.safeParse(plan);
 if(!parsed.success)return{status:'MIGRATION_PLAN_REQUIRED',reason:'The update needs a pre-existing approved migration contract.'};
 if(parsed.data.inputVersion!==current.version||parsed.data.outputVersion!==next.version)return{status:'MIGRATION_PLAN_REQUIRED',reason:'The migration contract versions do not match this update.'};
 return{status:'READY'};
}

/* ------------------------------------------------------------------ */
/* Update preview (M13-U02): capability expansion and data-migration     */
/* needs identified before any drain begins.                            */
/* ------------------------------------------------------------------ */

/** What an update would change: newly declared and removed capabilities,
 * whether the update needs a data migration, and a blocking code (currently
 * `MIGRATION_PLAN_REQUIRED`) or null when nothing blocks it. */
export interface UpdatePreview{capabilityExpansion:string[];capabilityRemoved:string[];migrationRequired:boolean;blocked:string|null}

/** Diff an update before any drain begins. Returns the capability
 * expansion/removal and `migrationRequired`. Fails closed: when a migration is
 * required, `blocked` is always `MIGRATION_PLAN_REQUIRED` — a validated
 * contract alone never unblocks a migration until a verified execution and
 * validation path exists. `_migrationPlan` is reserved for that path. */
export function updatePreview(current:PluginManifestV2,next:PluginManifestV2,requiresMigration:boolean,_migrationPlan?:unknown):UpdatePreview{
 const previous=new Set(current.declaredCapabilities),following=new Set(next.declaredCapabilities);
 const preview:UpdatePreview={
  capabilityExpansion:[...following].filter(capability=>!previous.has(capability)),
  capabilityRemoved:[...previous].filter(capability=>!following.has(capability)),
  migrationRequired:requiresMigration,
  blocked:null,
 };
 // Fail closed: a validated contract alone never unblocks a migration until a
 // verified execution/validation path exists.
 if(requiresMigration)preview.blocked='MIGRATION_PLAN_REQUIRED';
 return preview;
}
