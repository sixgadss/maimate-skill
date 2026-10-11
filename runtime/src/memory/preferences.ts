import { z } from 'zod';
import { channelSchema, mealPeriodSchema } from '../domain/schemas.js';
export const preferenceChangeSchema = z.object({ key: z.string().min(1).max(200),
  value: z.union([z.boolean(), z.number().finite(), z.string().max(200)]), rule: z.enum(['soft', 'exclude']),
  target: z.object({ provider: z.string().min(1), productId: z.string().min(1) }).nullable(),
  scope: z.object({ mealPeriod: mealPeriodSchema.optional(), channel: channelSchema.optional(),
    partySize: z.number().int().min(1).max(20).optional() }).strict() }).strict();
export type PreferenceChange = z.infer<typeof preferenceChangeSchema>;
