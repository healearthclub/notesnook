import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isHealEarthAccountId} from '../apps/mobile/app/features/login/account-identity.ts';
test('legacy and provider-independent account IDs survive the same native session validator',()=>{
 for(const id of ['google:109504381378772389840','google:fixture-sub','usr_7137e719-f4c7-4175-8aa3-c27a5bb21ec4'])assert.equal(isHealEarthAccountId(id),true,id);
 for(const id of [null,undefined,{},42,'','google:','someone@example.com','usr_not-a-uuid','usr_7137e719-f4c7-0175-8aa3-c27a5bb21ec4','google:subject\nother'])assert.equal(isHealEarthAccountId(id),false,String(id));
});
