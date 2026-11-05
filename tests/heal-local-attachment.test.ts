import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateLocalAttachment} from '../apps/web/src/utils/local-attachment-policy.ts';
test('local attachment imports reject active web content and mismatched binary headers',async()=>{
 for(const file of [new File(['<svg/>'],'image.svg',{type:'image/svg+xml'}),new File(['<html/>'],'page.html',{type:'text/html'}),new File(['not a PNG'],'photo.png',{type:'image/png'}),new File(['not a PDF'],'paper.pdf',{type:'application/pdf'}),new File([],'empty.txt',{type:'text/plain'})]) await assert.rejects(validateLocalAttachment(file));
 await validateLocalAttachment(new File([new Uint8Array([137,80,78,71,13,10,26,10,1])],'photo.png',{type:'image/png'}));
 await validateLocalAttachment(new File(['a harmless note'],'note.txt',{type:'text/plain'}));
});
