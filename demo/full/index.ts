import type { FullExample } from '../full-code';
import { core } from './core';
import { group_a } from './a';
import { group_b } from './b';
import { group_c } from './c';

export const examples: Record<string, FullExample> = { ...core, ...group_a, ...group_b, ...group_c };
