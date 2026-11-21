import {describe,expect,it} from 'vitest';
import {searchSettings,buildSupportedSettings} from '../apps/web/src/settings-registry';
import {SETTINGS_ROWS,SETTINGS_SECTIONS} from '../apps/web/src/Settings';
const rows=buildSupportedSettings(SETTINGS_ROWS,SETTINGS_SECTIONS);
describe('read-aloud search',()=>{
 it('finds voice and speed rows',()=>{
  for (const q of ['read aloud','voice','speed']) {
    const ids=searchSettings(q,rows,'desktop').map(r=>r.id);
    console.log(q,'->',ids.join(','));
    expect(ids.length).toBeGreaterThan(0);
  }
 });
});
