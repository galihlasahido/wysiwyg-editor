/** Every formula function, by name. */
import type { FnTable } from './formula-core';
import { DATA } from './formula-lib-data';
import { MATH } from './formula-lib-math';
import { TEXT } from './formula-lib-text';

export const LIBRARY: FnTable = { ...MATH, ...TEXT, ...DATA };
