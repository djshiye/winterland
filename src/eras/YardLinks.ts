/**
 * [eras] 0.9.12: the overhead links between one region's machines (eras/linkPlan.ts plans them, assets/yardLinks.ts
 * draws them in the era's style). Visual only: no collider, no zone, no item and nothing saved. Machines built or
 * demolished re-plan the links (checked twice a second, like the belts); the carriers ride while the region is drawn.
 */
import { createYardLinksModel, type YardLinksModel } from '../assets/yardLinks';
import { planYardLinks, type LinkMachine } from './linkPlan';
import type { Region } from './Region';

/** Seconds between two re-plans. */
const PLAN_EVERY = 0.5;

export class YardLinks {
  private model: YardLinksModel | null = null;
  private sig = '';
  private timer = 0;

  constructor(private readonly region: Region) {}

  /** Re-plan when the built machines changed. */
  sync(): void {
    const ms = this.region.machines;
    const sig = ms.map((m) => m?.def.id ?? '').join(',');
    if (sig === this.sig) return;
    this.sig = sig;
    this.model?.dispose();
    this.model = null;
    const machines: (LinkMachine | null)[] = ms.map((m) => (m ? { inputs: m.def.inputs, output: m.def.output, w: m.model.w, d: m.model.d } : null));
    const plan = planYardLinks(this.region.layout, machines);
    if (plan.links.length === 0) return;
    this.model = createYardLinksModel(this.region.era, plan);
    this.region.root.add(this.model.root);
  }

  update(dt: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = PLAN_EVERY;
      this.sync();
    }
    this.model?.update(dt);
  }

  /** Links and carriers standing now (tests, debug). */
  get stats(): { links: number; carriers: number } {
    return { links: this.model ? this.model.root.children.length : 0, carriers: this.model?.carriers ?? 0 };
  }

  dispose(): void {
    this.model?.dispose();
    this.model = null;
    this.sig = '';
  }
}
