# sys-elec — ELEC / HYD / BRAKES / FUEL / APU (`src/systems/elec-hyd-fuel-apu`)

Sim systems (order): elec 10, apu 20, hyd 50, brakes 55, fuel 60, elec-lights 99.
Service: `sim.services['sys-elec'] = { model, presets, preset(name) }` (9 presets, also in `src/dev/scenarios/sys-elec.ts`).
Displays: `ELEC_BAT1_V`, `ELEC_BAT2_V` (amber 7-segment, 88.8 on ANN LT TEST).

## Writes
- Everything listed for sys-elec in `docs/SIMVARS.md` (Electrical, Hydraulics/brakes, Fuel, APU) plus the "Requested by consumers" row,
  including `S:FUEL_PUMP_L1..R2_ON`, `S:FUEL_XFEED_MOVING`, `S:ANN_POWER` (= `S:ELEC_ANN_POWER`).
- Extras: bus voltages, source codes, battery contactor state / SOC, IDG temp / disconnect, TR / EMER GEN / inverter values,
  APU state / fault / cooldown / EGT limits, HYD low-pressure / fire-valve / leak-valve / PTU-enabled, normal brake pressures,
  fuel valve positions, pump pressures, centre AUTO run, APU LP valve and APU fuel pump.
- Every catalog light of ELEC / HYD / FUEL / APU panels (gated on DC BAT / DC ESS; EXT PWR AVAIL powered by the GPU).
- Events: `apu:start`, `elec:idg-disc {n}`.

## Reads from others
- sys-air: `S:ENGn_N2`, `S:ENGn_RUNNING`, `S:ENGn_OIL_PRESS`, `S:ENGn_FF`, `S:ENGn_START_VALVE`, `S:PACK1/2_FLOW`, `S:AI_WING_VALVE_L`, `S:AI_PROBE_HEAT`.
- sys-misc: `S:ADIRS_IAS`, `S:ADIRS_ON_BAT`, `S:FIRE_APU_DET`, `S:FIRE_APU_TEST`, `S:FCTL_SLATS`, `S:INTLT_ANN_TEST`, `S:INTLT_ANN_DIM`, `S:VENT_AVNCS_SMOKE` (0 unless smoke).
- G: `GND_EXT_PWR`, `AC_ON_GROUND`, `AC_GS_KT`, `AC_GW_KG`, `ENV_OAT`, `GND_TOWBAR`, `DOOR_CARGO_FWD/AFT`.

## Key values
Batteries 25.7–25.9 V cold, about −13 A on BAT only; TR1 ≈ 130 A charging on EXT PWR. APU (APS 3200) ≈ 55 s MASTER SW → AVAIL,
EGT peak ≈ 750 °C near 44 % N, stabilised ≈ 345 °C, 60 s cooling run. GEN online at N2 ≥ 55 %. HYD pressure switches 1450/1750 psi,
PTU at ΔP 500 psi. Brake accumulator 1000 psi precharge / 3000 psi charged.

## Gaps
No failure injection (BAT FAULT, reservoir OVHT / LO AIR, APU OIL LOW stay 0); EMER GEN simplified.
