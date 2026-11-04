import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {installPluginPackage,removePlugin,readPluginIndex,verifyPluginPackage} from '../packages/plugins/installation.ts';
const [action,...args]=process.argv.slice(2),root=resolve(process.env.HARNESS_PLUGIN_DIR??join(process.env.LOCALAPPDATA??homedir(),'GenV1','plugins'));
const version=JSON.parse(await readFile(resolve('package.json'),'utf8')).version as string;
if(action==='install'&&args.length===2){
  const result=await installPluginPackage(resolve(args[0]),root,args[1],version);
  process.stdout.write(JSON.stringify({id:result.manifest.id,version:result.manifest.version,digest:result.digest,directory:result.directory,restartRequired:true})+'\n');
}else if(action==='remove'&&args.length===1){await removePlugin(root,args[0]);process.stdout.write('Plug-in deactivated. Its package versions and saved data are retained. Restart Gen to refresh navigation.\n');}
else if(action==='list'&&!args.length){const plugins=[];for(const entry of await readPluginIndex(root))plugins.push((await verifyPluginPackage(join(root,entry.id,entry.version),entry.digest)).manifest);process.stdout.write(JSON.stringify({plugins},null,2)+'\n');}
else throw Error('Usage: pnpm plugin install <package-directory> <trusted-inventory-sha256> | remove <id> | list. Close Gen before installing or removing a plug-in.');
