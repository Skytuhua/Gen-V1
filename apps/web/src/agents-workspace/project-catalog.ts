/** Project filter catalog derived from the authoritative project list plus any project a
 * visible agent still references. Rebuilt from current inputs (not accumulated for the
 * component lifetime) so an authoritatively removed, unreferenced project drops out while
 * still-referenced projects remain (AUD-12). */
export function agentProjectCatalog(projects:readonly {id:string;name:string}[],agents:readonly {projectId:string|null;projectName:string|null}[]):Map<string,string>{
 const catalog=new Map<string,string>();
 for(const project of projects)catalog.set(project.id,project.name);
 for(const agent of agents)if(agent.projectId)catalog.set(agent.projectId,agent.projectName??agent.projectId);
 return catalog;
}

/** Options for the project filter Select. An applied filter whose project left the
 * catalog stays listed, so the displayed value always matches the applied scope (AUD-13). */
export function agentProjectFilterOptions(catalog:ReadonlyMap<string,string>,projectId:string|null|undefined):{value:string;label:string}[]{
 const options=[{value:'$all',label:'All projects'},...[...catalog].map(([value,label])=>({value,label}))];
 if(projectId!=null&&!catalog.has(projectId))options.push({value:projectId,label:projectId});
 options.push({value:'$none',label:'No project'});
 return options;
}
