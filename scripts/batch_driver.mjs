// Trusted runtime only. Generated engine is guarded before any import.
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const {guardEngineSource}=require('./engine_guard.cjs');
const TypeErrorClass=TypeError,RangeErrorClass=RangeError;
const MAX_PACKET=1048576,MAX_OUTPUT=16777216;
const FLAGS=['--disallow-code-generation-from-strings','--no-addons','--disable-proto=throw','--max-old-space-size=128'];
function fail(){throw new Error('OFFLINE_CHECK_FAILED');}
function exact(obj,keys){return obj!==null && typeof obj==='object' && Object.getPrototypeOf(obj)===Object.prototype && Object.keys(obj).length===keys.length && keys.every(k=>Object.hasOwn(obj,k));}
function whole(n){return Number.isSafeInteger(n)&&n>=0;}
function resultShape(v){
  if(!exact(v,['schemaVersion','rows','summary'])||v.schemaVersion!==1||!Array.isArray(v.rows)||v.rows.length>366||!exact(v.summary,['capturedL','servedL','shortageL','overflowL','finalL'])||!Object.values(v.summary).every(whole))fail();
  for(const row of v.rows)if(!exact(row,['day','capturedL','overflowL','servedL','shortageL','storedL'])||!Object.values(row).every(whole))fail();
}
function canonical(value,depth=0){
  if(depth>1024)fail();
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))fail();return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  if(value&&Object.getPrototypeOf(value)===Object.prototype)return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
  fail();
}
async function isolation(){
  const status=fs.readFileSync('/proc/self/status','utf8');
  if(!/^CapEff:\s*0+$/m.test(status)||!/^NoNewPrivs:\s*1$/m.test(status))fail();
  for(const path of ['/home','/root','/oracle','/dev/nvidia0','/dev/dri'])if(fs.existsSync(path))fail();
  if(Object.keys(process.env).some(k=>!['HOME','PATH','LANG','PWD'].includes(k))||process.env.PWD!=='/app')fail();
  if(!fs.existsSync(process.env.HOME)||fs.readdirSync(process.env.HOME).length)fail();
  const mounts=fs.readFileSync('/proc/self/mountinfo','utf8').trim().split('\n');
  for(const path of ['/app','/driver'])if(!mounts.some(row=>{const f=row.split(' ');return f[4]===path&&f[5].split(',').includes('ro');}))fail();
  if(fs.readFileSync('/proc/net/route','utf8').trim().split('\n').length!==1)fail();
  const errno=await new Promise(resolve=>{const socket=net.createConnection({host:'192.0.2.1',port:9});socket.setTimeout(100);socket.once('error',e=>{socket.destroy();resolve(e.code);});socket.once('timeout',()=>{socket.destroy();resolve('TIMEOUT');});socket.once('connect',()=>{socket.destroy();resolve('CONNECTED');});});
  if(errno!=='ENETUNREACH')fail();
  return {sourceReadOnly:true,oracleAbsent:true,homeEmpty:true,credentialsAbsent:true,environmentClean:true,CapEff:0,NoNewPrivs:1,networkError:errno};
}
function inputPacket(){
  let size=0;const chunks=[];
  while(true){const buf=Buffer.alloc(16384);const n=fs.readSync(0,buf,0,buf.length,null);if(!n)break;size+=n;if(size>MAX_PACKET)fail();chunks.push(buf.subarray(0,n));}
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  const packet=JSON.parse(raw);
  if(!exact(packet,['cases'])||!Array.isArray(packet.cases)||packet.cases.length>256)fail();
  canonical(packet);
  return packet;
}
try{
  if(!/^v22\./.test(process.version))fail();
  const proof=await isolation();
  const source=fs.readFileSync('/app/src/engine.js','utf8');guardEngineSource(source);
  if(process.argv.length===3&&process.argv[2]==='--public'){
    const tests=fs.readdirSync('/app/tests').filter(n=>/^[A-Za-z0-9_-]+\.test\.js$/.test(n)).sort().map(n=>'/app/tests/'+n);
    if(!tests.length)fail();
    const run=spawnSync(process.execPath,[...FLAGS,'--test','--test-concurrency=1',...tests],{encoding:'utf8',timeout:60000,maxBuffer:MAX_OUTPUT,env:process.env});
    if(run.error||run.status!==0){const log=Buffer.from(run.stdout||'','utf8').subarray(0,262144).toString('utf8');process.stdout.write('PUBLIC_TEST_LOG_BEGIN\n'+log+'\nPUBLIC_TEST_LOG_END\n');fail();}
    const counts={};for(const key of ['tests','pass','fail','cancelled','skipped','todo']){const found=[...run.stdout.matchAll(new RegExp('^# '+key+' ([0-9]+)$','gm'))];if(found.length!==1)fail();counts[key]=Number(found[0][1]);}
    if(counts.tests<1||counts.pass!==counts.tests||counts.fail||counts.cancelled||counts.skipped||counts.todo)fail();
    const build=spawnSync(process.execPath,[...FLAGS,'/app/scripts/build.mjs','--output','/tmp/atendimento-dist'],{encoding:'utf8',timeout:30000,maxBuffer:MAX_OUTPUT,env:process.env});
    if(build.error||build.status!==0)fail();
    process.stdout.write('PUBLIC_TESTS '+counts.tests+'\nPROOF '+JSON.stringify(proof)+'\n');
  }else{
    if(process.argv.length!==2)fail();
    const packet=inputPacket();
    const engine=await import('file:///app/src/engine.js');
    if(Object.keys(engine).length!==1||typeof engine.simulate!=='function')fail();
    const results=[];
    for(const input of packet.cases){
      const before=canonical(input);
      let record,value;
      try{value=engine.simulate(input);}
      catch(error){if(error instanceof TypeErrorClass)record={ok:false,error:'TypeError'};else if(error instanceof RangeErrorClass)record={ok:false,error:'RangeError'};else throw error;}
      if(!record){resultShape(value);canonical(value);record={ok:true,value};}
      if(canonical(input)!==before)fail();results.push(record);
    }
    const out=JSON.stringify({results});if(Buffer.byteLength(out,'utf8')>MAX_OUTPUT)fail();process.stdout.write(out+'\n');
  }
}catch(_){process.stderr.write('OFFLINE_CHECK_FAILED\n');process.exitCode=2;}
