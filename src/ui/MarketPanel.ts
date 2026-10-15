/**
 * [STUB — market builder replaces the body, keeps the public API] 0.9.0 Market panel: Prices (sparklines, sell
 * pressure), Trade (buy / sell virtual holdings, order deliveries to a region's import dock), Invest (bonds, index
 * fund, era ventures), net worth. Opened by 'market:open' (HUD button), closed by 'market:close' / Esc.
 */
import type { GameContext } from '../core/types';

export class MarketPanel {
  constructor(
    protected readonly ctx: GameContext,
    protected readonly layer: HTMLElement,
  ) {}

  get visible(): boolean {
    return false;
  }

  close(): void {}

  update(_dt: number): void {}
}
