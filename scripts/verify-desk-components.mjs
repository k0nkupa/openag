// Source coverage gate, alongside real gateway/browser acceptance. Not a visual certification.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const walk=path=>readdirSync(root+path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path+'/'+entry.name):[path+'/'+entry.name]);
const files=walk('apps/desk/src').filter(path=>path.endsWith('.tsx')&&!/\.(test|spec)\.tsx$/.test(path));
const audit=readFileSync(root+'docs/notes/desk-component-consistency-audit.md','utf8');
const inventory=new Set([...audit.matchAll(/^\| \[[^\]]+\]\(\.\.\/\.\.\/(apps\/desk\/src\/[^)]+)\)/gm)].map(match=>match[1]));
const permitted=(path,tag,attributes)=>tag==='input'&&((path.endsWith('/Composer.tsx')&&/sr-only/.test(attributes)||path.endsWith('/ProfileSettings.tsx')&&/className="hidden"/.test(attributes))&&/type="file"/.test(attributes)||path.endsWith('/AvatarEditor.tsx')&&/type="radio"/.test(attributes)&&/OPTION_INPUT/.test(attributes));
assert.equal(permitted('apps/desk/src/components/Login.tsx','input','type="text"'),false);
assert.equal(permitted('apps/desk/src/components/Composer.tsx','input','type="file" className="sr-only"'),true);
const css=readFileSync(root+'apps/desk/src/styles.css','utf8');
assert.ok(css.includes('@import \"tailwindcss\";'), 'Shared Tailwind stylesheet entry must remain loaded');
assert.ok(css.includes('@custom-variant dark'), 'Theme variants must follow the shared effective theme');
let exceptions=0;
for(const path of files){
 assert.ok(inventory.has(path),'Unaccounted production module: '+path);
 const source=readFileSync(root+path,'utf8');
 assert.ok(!/\bNativeSelect\b/.test(source),'Retired NativeSelect returned: '+path);
 if(path.includes('/components/ui/'))continue;
 assert.ok(!/\[&>button[^\]]*\]:(?:rounded|bg-|text-|border|h-|min-h-)/.test(source),'Competing ancestor button skin: '+path);
 assert.ok(!/(?:bg|text|border)-\[#[0-9a-f]/i.test(source),'Unscoped feature colour: '+path);
 for(const match of source.matchAll(/<(button|input|select|textarea|table|details|pre)\b([\s\S]*?)(?:\/>|>)/g)){
  assert.ok(permitted(path,match[1],match[2]),'Unexplained raw control: '+path+' '+match[1]);exceptions++;
 }
}
assert.equal(exceptions,5,'Only two hidden file inputs and three artwork radio source sites remain');
assert.ok(!/Pending implementation/.test(audit),'Audit still has unresolved source rows');
console.log(`PASS ${files.length} production TSX modules accounted for; 5 documented specialised source sites; no unexplained raw ordinary controls. Visual/browser evidence is separate.`);
