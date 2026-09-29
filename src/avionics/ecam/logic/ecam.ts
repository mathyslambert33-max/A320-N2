/**
 * ECAM core system (DOM-free): FWC + DMC page logic + ECAM control panel + DU power states.
 * Registered on the sim bus at order 90 (after all aircraft systems).
 */
import type { Sim, SimSystem } from '../../../core/sim';
import { DuState } from './du';
import { Fwc } from './fwc';
import { SdPageLogic } from './sdpage';
import { PAGE_KEYS, SdPage } from './types';

export class EcamCore implements SimSystem {
  readonly name = 'ecam';
  readonly order = 90;
  readonly fwc = new Fwc();
  readonly sd = new SdPageLogic();
  /** Upper DU (E/WD) and lower DU (SD). Self-test durations differ slightly between units. */
  readonly duUpper = new DuState('EWD', 26);
  readonly duLower = new DuState('SD', 31);
  /** E/WD format transferred to the lower DU (upper DU off / failed). */
  ewdOnLower = false;
  /** DMC feeding each DU is valid. */
  upperDataValid = true;
  lowerDataValid = true;
  sim!: Sim;

  private toCfgLatch = false;
  private rclHeldFor = 0;
  private rclLongDone = false;
  private ecpPowered = false;
  private offs: Array<() => void> = [];

  constructor(sim: Sim) {
    this.sim = sim;
    const on = (ev: string, fn: () => void) => this.offs.push(sim.on(ev, fn));
    const ecpOk = () => this.ecpPowered && this.fwc.powered;
    on('WARN_MASTER_WARN_CAPT:press', () => this.fwc.powered && this.fwc.pressMasterWarn());
    on('WARN_MASTER_WARN_FO:press', () => this.fwc.powered && this.fwc.pressMasterWarn());
    on('WARN_MASTER_CAUT_CAPT:press', () => this.fwc.powered && this.fwc.pressMasterCaut());
    on('WARN_MASTER_CAUT_FO:press', () => this.fwc.powered && this.fwc.pressMasterCaut());
    for (const [page, key] of PAGE_KEYS) on(`${key}:press`, () => ecpOk() && this.sd.pressPage(page));
    on('ECP_ALL:press', () => ecpOk() && this.sd.setAllHeld(true));
    on('ECP_ALL:release', () => this.sd.setAllHeld(false));
    const clr = () => {
      if (!ecpOk()) return;
      if (!this.fwc.clear()) this.sd.clearStatus();
    };
    on('ECP_CLR_L:press', clr);
    on('ECP_CLR_R:press', clr);
    on('ECP_STS:press', () => ecpOk() && this.sd.pressSts(this.fwc));
    on('ECP_RCL:press', () => {
      if (!ecpOk()) return;
      this.rclHeldFor = 0;
      this.rclLongDone = false;
      this.fwc.recall(false);
    });
    on('ECP_EMER_CANC:press', () => ecpOk() && this.fwc.emerCanc());
    on('ECP_TO_CONFIG:press', () => { this.toCfgLatch = true; });
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs = [];
  }

  update(dt: number, sim: Sim): void {
    this.sim = sim;
    const fwc = this.fwc;
    const a = fwc.a;
    // T.O CONFIG pb (held state from the control, latched press for very short clicks)
    fwc.toCfgPressed = sim.getB('C:ECP_TO_CONFIG') || this.toCfgLatch;
    this.toCfgLatch = false;
    fwc.update(sim, dt);

    this.ecpPowered = a.dcEss || a.dc2 || a.dcBat;
    // ALL key: also follow the control (release events may be missed)
    if (!sim.getB('C:ECP_ALL')) this.sd.setAllHeld(false);
    // RCL held more than 3 s: cancelled cautions are recalled
    if (sim.getB('C:ECP_RCL')) {
      this.rclHeldFor += dt;
      if (this.rclHeldFor >= 3 && !this.rclLongDone) { this.rclLongDone = true; fwc.recall(true); }
    } else this.rclHeldFor = 0;

    const page = this.sd.update(fwc, dt);

    // ---- display units
    const upBrt = sim.get('C:ECP_UPPER_BRT');
    const loBrt = sim.get('C:ECP_LOWER_BRT');
    this.duUpper.update(a.acEss, upBrt, dt);
    this.duLower.update(a.ac2, loBrt, dt);
    const dmcUpper = a.swEisDmc === 0 ? a.dmc3 : a.dmc1;
    const dmcLower = a.swEisDmc === 2 ? a.dmc3 : a.dmc2;
    this.upperDataValid = dmcUpper;
    this.lowerDataValid = dmcLower;
    this.ewdOnLower = (this.duUpper.mode === 'OFF' || this.duUpper.mode === 'STBY') && this.duLower.mode === 'ON';

    // ---- published state
    sim.set('S:FWC_FLIGHT_PHASE', fwc.powered ? fwc.phase : 0);
    sim.set('S:FWC_POWERED', fwc.powered);
    sim.set('S:FWC_MASTER_WARN', fwc.masterWarn);
    sim.set('S:FWC_MASTER_CAUT', fwc.masterCaut);
    sim.set('S:FWC_CRC', fwc.crcActive);
    sim.set('S:FWC_TO_MEMO', fwc.toMemo);
    sim.set('S:FWC_TO_CONFIG_OK', fwc.toConfigNormal);
    sim.set('S:FWC_WARNING_COUNT', fwc.displayedAlerts().filter((s) => s.def.level === 3).length);
    sim.set('S:FWC_CAUTION_COUNT', fwc.displayedAlerts().filter((s) => s.def.level < 3).length);
    sim.set('S:ECAM_SD_PAGE', this.duLower.mode === 'ON' && !this.ewdOnLower ? page : SdPage.NONE);
    sim.set('S:ECAM_SD_PAGE_SELECTED', page);
    sim.set('S:DMC_POWERED_1', a.dmc1);
    sim.set('S:DMC_POWERED_2', a.dmc2);
    sim.set('S:DMC_POWERED_3', a.dmc3);
    sim.set('S:ECAM_UPPER_DU_ON', this.duUpper.mode === 'ON');
    sim.set('S:ECAM_LOWER_DU_ON', this.duLower.mode === 'ON');

    // ---- lights (annunciators need DC power; the kit handles ANN LT TEST / DIM)
    const ann = a.annPower;
    const flash = Math.floor(sim.time * 2) % 2 === 0; // MASTER WARN flashes at 1 Hz
    sim.set('L:MASTER_WARN', ann && fwc.masterWarn && flash);
    sim.set('L:MASTER_CAUT', ann && fwc.masterCaut);
    const ecpLt = ann && this.ecpPowered && fwc.powered;
    for (const [p, key] of PAGE_KEYS) sim.set(`L:${key}`, ecpLt && this.sd.keyLit(p));
    sim.set('L:ECP_STS', ecpLt && this.sd.statusDisplayed());
    sim.set('L:ECP_CLR', ecpLt && (fwc.leftFailures || this.sd.statusDisplayed()));
  }
}
