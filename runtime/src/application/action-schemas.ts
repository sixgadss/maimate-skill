import { z } from 'zod';
const ref=z.string().min(1).max(200),text=z.string().min(1).max(5000);
export const feedbackSchema=z.union([
  z.object({kind:z.enum(['accepted','rejected']),recommendationId:ref,candidateId:ref,userTurnRef:ref}).strict(),
  z.object({kind:z.literal('statement'),text,persistence:z.enum(['session','long_term']),userTurnRef:ref}).strict(),
  z.object({kind:z.literal('meal_feedback'),orderId:ref,text,userTurnRef:ref}).strict(),
]);
export const memoryActionSchema=z.union([
  z.object({action:z.literal('list')}).strict(),
  z.object({action:z.literal('correct'),preferenceId:ref,text,userTurnRef:ref}).strict(),
  z.object({action:z.literal('delete'),preferenceIds:z.array(ref).min(1).max(100),mode:z.enum(['undoable','erase']).optional(),userTurnRef:ref}).strict(),
  z.object({action:z.literal('undo'),undoRef:ref,userTurnRef:ref}).strict(),
  z.object({action:z.enum(['pause','resume','clear']),userTurnRef:ref}).strict(),
]);
