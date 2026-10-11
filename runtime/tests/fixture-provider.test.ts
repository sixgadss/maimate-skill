import { it, expect } from 'vitest';
import { FixtureProvider } from '../src/providers/fixture-provider.js';
import { scope, NOW } from './helpers.js';

const request = () => ({ scope: { ...scope(), channel: 'delivery' as const, addressRef: 'demo-address' },
  items: [{ productId: 'chicken', variantId: null, configurationRef: null, quantity: 1 }],
  couponIds: [] as string[], pointsPlanRef: null, tablewareRequested: false });

it('quotes synthetic food with delivery fee and fixture provenance', async () => {
  const p = new FixtureProvider(() => NOW);
  const q = await p.calculateOrder(request());
  expect(q).toMatchObject({ ok: true, data: { payable: { amountFen: 1900 }, completeFees: true }, meta: { mode: 'fixture' } });
});
it('rejects unheld or expired coupons and incompatible stacking', async () => {
  const p = new FixtureProvider(() => NOW);
  for (const couponIds of [['unheld'], ['expired'], ['chicken-discount', 'other-discount']]) {
    expect(await p.calculateOrder({ ...request(), couponIds })).toMatchObject({ ok: false, error: { code: 'PROMOTION_INELIGIBLE' } });
  }
  const q = await p.calculateOrder({ ...request(), couponIds: ['chicken-discount'] });
  expect(q).toMatchObject({ ok: true, data: { payable: { amountFen: 1700 } } });
});
it('marks unknown delivery fees incomplete and does not claim sellability for unknown products', async () => {
  const p = new FixtureProvider(() => NOW, { deliveryFeeFen: null });
  expect(await p.calculateOrder(request())).toMatchObject({ ok: true, data: { completeFees: false, verifiedTotal: false } });
  expect(await p.calculateOrder({ ...request(), items: [{ ...request().items[0]!, productId: 'missing' }] }))
    .toMatchObject({ ok: false, error: { code: 'NOT_SELLABLE' } });
});
it('cannot spend points or create any real order', async () => {
  const p = new FixtureProvider(() => NOW);
  expect(await p.getUserPoints()).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
  expect(await p.createOrder({ quoteId: 'q', expectedSnapshotHash: 's', idempotencyKey: 'i', remark: null }))
    .toMatchObject({ ok: false, error: { code: 'UNSUPPORTED' } });
});
