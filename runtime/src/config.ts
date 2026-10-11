import type { Channel } from './contracts/provider.js';
export interface Config { restaurantId: string | null; businessEntityId: string | null;
  channel: Channel | null; timezone: string; deadlineMs: number; maxCandidates: number;
  quoteBatchSize: number; quoteConcurrency: number; userId: string; }
export function defaultConfig(): Config {
  return { restaurantId: null, businessEntityId: null, channel: null, timezone: 'Asia/Shanghai',
    deadlineMs: 12_000, maxCandidates: 80, quoteBatchSize: 12, quoteConcurrency: 3, userId: 'local' };
}
