/** Container shared by the sub-systems of this module (one instance per installed app). */
import type { ElecModel } from './elec';
import type { ApuModel } from './apu';
import type { HydModel } from './hyd';
import type { BrakeModel } from './brakes';
import type { FuelModel } from './fuel';

export interface Model {
  rng: () => number;
  elec: ElecModel;
  apu: ApuModel;
  hyd: HydModel;
  brk: BrakeModel;
  fuel: FuelModel;
}
