import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const {build}=require('esbuild');
test('actual SQLite worker closes once after a pending query and never finalizes a stale handle',async()=>{
 let release;const pending=new Promise(r=>release=r);const events=[];let closed=false,finalized=false;
 const sqlite={vfs_register(){},open_v2:async()=>1,create_function(){},str_new:()=>1,str_value:()=>1,str_finish(){},prepare_v2:async()=>({stmt:2}),column_names:()=>[],register_extensions:async()=>{},step:async()=>{events.push('step');await pending;assert.equal(closed,false);return 101;},reset:async()=>{assert.equal(finalized,false);events.push('reset');},finalize:async()=>{assert.equal(finalized,false);finalized=true;events.push('finalize');},close:async()=>{assert.equal(closed,false);closed=true;events.push('close');},last_insert_rowid:()=>0,changes:()=>0};
 const result=await build({entryPoints:['apps/web/src/common/sqlite/sqlite.worker.ts'],absWorkingDir:new URL('..',import.meta.url).pathname,bundle:true,write:false,platform:'node',format:'cjs',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/sqlite-api$|comlink$|shared-service$|wa-sqlite(-async)?$|IDBBatchAtomicVFS$|AccessHandlePoolVFS$|sqlite-export$|utils\/error$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('sqlite-api')?'export const Factory=()=>globalThis.fixtureSqlite;export const SQLITE_ROW=100,SQLITE_UTF8=1;export class SQLiteError extends Error {}':a.path==='comlink'?'export const expose=x=>globalThis.fixtureWorker=x;export const transfer=x=>x;':a.path.endsWith('shared-service')?'export const createSharedServicePort=()=>null;':/wa-sqlite(-async)?$/.test(a.path)?'export default async()=>({});':a.path.endsWith('VFS')?'export class IDBBatchAtomicVFS {name="fixture";async close(){} } export class AccessHandlePoolVFS {}':a.path.endsWith('sqlite-export')?'export class DatabaseSource {}':'export const rewriteError=(e)=>e;'}));}}]});
 const context={fixtureSqlite:sqlite,console,MessageEvent:class{},addEventListener(){},self:{dispatchEvent(){},addEventListener(){}},exports:{},module:{exports:{}}};context.globalThis=context;
 vm.runInNewContext(result.outputFiles[0].text,context);const worker=context.fixtureWorker;
 await worker.open('fixture',{async:true,encrypted:false});
 const query=worker.run('query','select 1');
 while(!events.includes('step'))await new Promise(r=>setImmediate(r));
 const closing=worker.close();const closingAgain=worker.close();
 assert.deepEqual(events,['step']);release();await Promise.all([query,closing,closingAgain]);
 assert.deepEqual(events,['step','reset','finalize','close']);
});
