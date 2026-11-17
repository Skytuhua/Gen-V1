import {describe,expect,it} from 'vitest';
import {mapSelectedText} from '../apps/web/src/SourceSelectionActions';
describe('M15 exact rendered selection mapping',()=>{
 it('uses UTF16 offsets across non-BMP text',()=>expect(mapSelectedText('A😀 selected text.','selected')).toEqual({start:4,end:12,text:'selected'}));
 it('refuses ambiguous repeated text rather than citing the wrong range',()=>expect(mapSelectedText('same then same','same')).toBeNull());
 it('refuses forged or empty selection content',()=>{expect(mapSelectedText('canonical','forged')).toBeNull();expect(mapSelectedText('canonical','')).toBeNull();});
 it('retains exact whitespace and newlines',()=>expect(mapSelectedText('prefix\n  selected\nend','\n  selected\n')).toEqual({start:6,end:18,text:'\n  selected\n'}));
});
