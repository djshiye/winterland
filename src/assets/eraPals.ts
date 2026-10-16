/**
 * 0.9.5: which companion model trots beside the player in each era region when that era's `${key}Pal` upgrade is
 * owned (entities/Dog.ts, eras/playerUpgrades.ts). Every builder keeps the husky's DogModel contract (assets/sled.ts).
 * Eras without a model of their own yet fall back to the husky. One line per era file:
 */
import type { DogModel } from './sled';
import { createEra2to4Pal } from './eraPals2to4';
import { createEra5to7Pal } from './eraPals5to7';
import { createEraPal } from './eraPals4';

export const ERA_PAL_MODELS: Partial<Record<number, () => DogModel>> = {
  // eras 2-4 (assets/eraPals2to4.ts: Pack Mule, Pit Pony, Brass Terrier)
  2: () => createEra2to4Pal(2),
  3: () => createEra2to4Pal(3),
  4: () => createEra2to4Pal(4),
  // eras 5-7 (assets/eraPals5to7.ts)
  5: () => createEra5to7Pal(5),
  6: () => createEra5to7Pal(6),
  7: () => createEra5to7Pal(7),
  // eras 8-10 (assets/eraPals4.ts: Rover Bot, Rad Drone, Robo Pup)
  8: () => createEraPal(8),
  9: () => createEraPal(9),
  10: () => createEraPal(10),
};
