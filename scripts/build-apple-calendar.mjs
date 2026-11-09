// Build locally before package review: the resulting executable is part of the pinned folder digest.
import {readFileSync,writeFileSync,existsSync,chmodSync,renameSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
if(process.platform!=='darwin')process.exit(0);
const dir=fileURLToPath(new URL('../examples/mcp/apple-apps/',import.meta.url)),binary=dir+'calendar-reader',metadata=dir+'calendar-build.json';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const source=hash(readFileSync(dir+'calendar-reader.swift')),usage=hash(readFileSync(dir+'calendar-reader.plist')),compiler=execFileSync('/usr/bin/xcrun',['swiftc','--version'],{encoding:'utf8',timeout:15000}).trim();
let cached;try{cached=JSON.parse(readFileSync(metadata,'utf8'));}catch{}
if(cached?.source===source&&cached.usage===usage&&cached.compiler===compiler&&cached.arch===process.arch&&existsSync(binary)&&hash(readFileSync(binary))===cached.binary){chmodSync(binary,0o700);console.log('Calendar helper current');process.exit(0);}
const temporary=binary+'-'+randomUUID();
try{
 execFileSync('/usr/bin/xcrun',['swiftc','-O','-target',process.arch==='arm64'?'arm64-apple-macosx14.0':'x86_64-apple-macosx14.0',dir+'calendar-reader.swift','-Xlinker','-sectcreate','-Xlinker','__TEXT','-Xlinker','__info_plist','-Xlinker',dir+'calendar-reader.plist','-o',temporary],{stdio:'pipe',timeout:60000});
 chmodSync(temporary,0o700);renameSync(temporary,binary);
 writeFileSync(metadata,JSON.stringify({source,usage,compiler,arch:process.arch,binary:hash(readFileSync(binary))})+'\n',{mode:0o600});
 console.log('Calendar helper built');
}finally{rmSync(temporary,{force:true});}
