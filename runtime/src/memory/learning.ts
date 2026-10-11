import type { OrderReceipt } from '../contracts/provider.js';
import type { Preference } from '../contracts/memory.js';
import { stableHash } from '../domain/schemas.js';
export function inferFrequent(orders: OrderReceipt[], userId: string, blocked: string[]): Preference[] {
  const groups = new Map<string, { provider: string; productId: string; orders: OrderReceipt[] }>();
  for (const o of orders) for (const id of new Set(o.items.map(i => i.productId))) {
    const key = `${o.provider}:${id}`;
    const group = groups.get(key) ?? { provider: o.provider, productId: id, orders: [] };
    group.orders.push(o); groups.set(key, group);
  }
  return [...groups.values()].flatMap(g => {
    const key = `behavior.frequent:${g.provider}:${g.productId}`;
    if (blocked.includes(key) || blocked.includes(`product:${g.provider}:${g.productId}`)) return [];
    const latest = g.orders.map(o => o.createdAt).sort().at(-1)!;
    const n = g.orders.length;
    return [{ id: stableHash([userId, key]), userId, key, value: 'frequently_selected',
      kind: 'inferred' as const, rule: 'soft' as const, target: { provider: g.provider, productId: g.productId },
      scope: {}, confidence: n / (n + 4), sourceEventIds: g.orders.map(o => `order:${o.provider}:${o.orderId}`),
      updatedAt: latest, expiresAt: new Date(Date.parse(latest) + 90 * 86400_000).toISOString() }];
  });
}
