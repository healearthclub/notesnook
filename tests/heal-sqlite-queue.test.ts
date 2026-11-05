import {test} from 'node:test';
import assert from 'node:assert/strict';
import {OperationQueue} from '../apps/web/src/common/sqlite/operation-queue.ts';
test('database shutdown waits for in-flight queries and failure does not poison subsequent work',async()=>{
 const queue=new OperationQueue();let release!:()=>void;const barrier=new Promise<void>(r=>release=r);const events:string[]=[];
 const query=queue.run(async()=>{events.push('query start');await barrier;events.push('query end');});
 const shutdown=queue.run(async()=>{events.push('close');});
 await Promise.resolve();assert.deepEqual(events,['query start']);release();await Promise.all([query,shutdown]);assert.deepEqual(events,['query start','query end','close']);
 await assert.rejects(queue.run(async()=>{throw Error('failed query');}));
 assert.equal(await queue.run(async()=>42),42);
});
