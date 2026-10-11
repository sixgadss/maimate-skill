import assert from 'node:assert/strict';
import type {McDonaldsProvider} from '../src/contracts/provider.js';
import {FixtureProvider} from '../src/providers/fixture-provider.js';
const provider:McDonaldsProvider=new FixtureProvider();
const capabilities=await provider.capabilities();assert(capabilities.ok&&capabilities.meta.mode==='fixture');
const stores=await provider.getNearbyRestaurants({channel:'pickup'});assert(stores.ok);
const blocked=await provider.createOrder({quoteId:'example',expectedSnapshotHash:'example',idempotencyKey:'example',remark:null});assert(!blocked.ok&&blocked.error.code==='UNSUPPORTED');
console.log(JSON.stringify({source:'合成供应商示例',capabilities,stores,ordering:blocked},null,2));
