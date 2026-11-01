import {readFile,writeFile,copyFile,cp,mkdir,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';

const evidence=resolve('docs/evidence/dark-micro-motion-20261031');
const site=resolve('sites/harness-video-review-20261030/dist');
const destination=join(site,'reviews/dark-micro-motion-20261031');
const manifest=JSON.parse(await readFile(join(evidence,'review/manifest.json'),'utf8'));
if(manifest.videos.length!==30||manifest.videos.some(video=>video.theme!=='dark'))throw Error('All 30 completed dark recordings are required.');
await access(join(evidence,'report.md'));
await mkdir(join(site,'reviews'),{recursive:true});
await cp(join(evidence,'review'),destination,{recursive:true,force:false,errorOnExist:true});
await cp(join(evidence,'reference-analysis'),join(destination,'reference-analysis'),{recursive:true,force:false,errorOnExist:true});
await cp(join(evidence,'video-inspection-final'),join(destination,'video-inspection'),{recursive:true,force:false,errorOnExist:true});
for(const file of ['report.md','motion-coverage.md','coherent-review.md','source-freeze.json','checks.json']){
 let bytes=await readFile(join(evidence,file));
 if(file==='motion-coverage.md')bytes=Buffer.from(bytes.toString('utf8').replace('../reference-analysis/','reference-analysis/'));
 await writeFile(join(destination,file),bytes,{flag:'wx'});
}
// Preserve the prior main page, then put every new recording directly on the
// current main page. Fragment links stay local; assets use their review paths.
await copyFile(join(site,'index.html'),join(site,'review-index-before-dark-20261031.html'),constants.COPYFILE_EXCL);
const html=await readFile(join(destination,'index.html'),'utf8');
const root=html.replace(/\b(src|poster|href)="([^"]+)"/g,(match,attribute,url)=>{
 if(url.startsWith('#')||/^[a-z]+:/i.test(url)||url.startsWith('/'))return match;
 return `${attribute}="${new URL(url,'https://review.invalid/reviews/dark-micro-motion-20261031/').pathname}"`;
});
await writeFile(join(site,'index.html'),root);
console.log(JSON.stringify({site,destination,videos:manifest.videos.length,components:manifest.componentCoverage.length}));
