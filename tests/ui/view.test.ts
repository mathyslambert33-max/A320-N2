/** First-person head model (src/ui/view.ts): limits, presets, mirroring for the F/O seat. */
import { describe, expect, it } from 'vitest';
import { ANGLE_LIMITS, EYE, HEAD_LIMITS, PRESETS, aim, clampAngles, clampHead, presetPose, torsoTwist, type PresetId } from '../../src/ui/view';

const D = Math.PI / 180;

describe('head model', () => {
  it('aims with the body-frame conventions (yaw > 0 = left, pitch > 0 = up)', () => {
    const [y0, p0] = aim([0, 0, 0], [0, 0, -1]);
    expect(y0).toBeCloseTo(0);
    expect(p0).toBeCloseTo(0);
    expect(aim([0, 0, 0], [-1, 0, 0])[0]).toBeCloseTo(90 * D);
    expect(aim([0, 0, 0], [0, 1, -1])[1]).toBeCloseTo(45 * D);
  });

  it('clamps the head inside the seat envelope, mirrored for the F/O', () => {
    expect(clampHead('capt', [5, 5, 5])).toEqual([HEAD_LIMITS.x[1], HEAD_LIMITS.y[1], HEAD_LIMITS.z[1]]);
    expect(clampHead('fo', [5, 0, 0])[0]).toBeCloseTo(-HEAD_LIMITS.x[0]);
    expect(clampHead('fo', [-5, 0, 0])[0]).toBeCloseTo(-HEAD_LIMITS.x[1]);
    // slouching limits the forward lean (glareshield ahead)
    expect(clampHead('capt', [0, -0.22, -1])[2]).toBeGreaterThan(HEAD_LIMITS.z[0]);
    const [yaw, pitch] = clampAngles('capt', -4, 4);
    expect(yaw).toBeCloseTo(-ANGLE_LIMITS.yawInboard);
    expect(pitch).toBeCloseTo(ANGLE_LIMITS.pitchUp);
    expect(clampAngles('fo', 4, 0)[0]).toBeCloseTo(ANGLE_LIMITS.yawInboard);
  });

  it('never puts the eye into the panels: every preset stays inside the envelope and in front of the main panel', () => {
    for (const seat of ['capt', 'fo'] as const) {
      for (const id of Object.keys(PRESETS) as PresetId[]) {
        for (let v = 0; v < PRESETS[id].length; v++) {
          const p = presetPose(seat, id, v);
          const eye = [EYE[seat][0] + p.off[0], EYE[seat][1] + p.off[1], EYE[seat][2] + p.off[2]];
          expect(eye[2]).toBeGreaterThan(-0.45); // main panel face ≈ −0.72, glareshield ≈ −0.75
          expect(eye[1]).toBeGreaterThan(1.0);
          expect(eye[1]).toBeLessThan(1.45); // overhead ≥ 1.75
          expect(Math.abs(eye[0])).toBeLessThan(0.8);
          expect(Math.abs(eye[0])).toBeGreaterThan(0.1); // not above the pedestal centre line
        }
      }
    }
  });

  it('presets point at the right panels', () => {
    const ov = presetPose('capt', 'overhead');
    expect(ov.pitch).toBeGreaterThan(25 * D);
    const ped = presetPose('capt', 'pedestal');
    expect(ped.pitch).toBeLessThan(-35 * D);
    expect(ped.yaw).toBeLessThan(0); // captain looks right toward the pedestal
    expect(presetPose('fo', 'pedestal').yaw).toBeGreaterThan(0);
    const door = presetPose('capt', 'door');
    expect(Math.abs(door.yaw)).toBeGreaterThan(140 * D);
    expect(presetPose('capt', 'left').yaw).toBeGreaterThan(60 * D);
    // variants cycle
    expect(presetPose('capt', 'overhead', 1).label).toMatch(/ADIRS/);
    expect(presetPose('capt', 'overhead', 2).label).toBe(presetPose('capt', 'overhead', 0).label);
  });

  it('turns the torso when looking back toward the aisle', () => {
    for (const v of torsoTwist('capt', 0)) expect(Math.abs(v)).toBe(0);
    expect(torsoTwist('capt', -160 * D)[0]).toBeGreaterThan(0.1);
    expect(torsoTwist('fo', 160 * D)[0]).toBeLessThan(-0.1);
  });
});
