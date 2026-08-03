/**
 * Signal programs: a repeating phase timeline per signal id, plus the stop-line
 * arc lengths it controls.
 *
 * The engine does not read signal geometry from the map — `signalPrograms` on
 * `SimScenarioInput` carries everything, so an adapter can bind a template's
 * `signal:*` references to whatever the site actually has (or synthesise a
 * program for an unsignalised study).
 *
 * The timeline starts at `t = -warmupSeconds + offsetS`, so a program is
 * already mid-cycle when the recorded clip begins — actors never see an
 * unnaturally fresh cycle at `t = 0`.
 */

import type { LaneRsl } from '../map/topology.js';
import type { ControlIndication, RoadControl, SignalProgram } from '../schema/input.js';

export type SignalPhase = ControlIndication;

/** Observable phase plus the source that currently owns it. Program timing
 * provenance remains on `SignalProgram.mapBinding.timingSource`; `source`
 * distinguishes that cycle from a runtime `set(signal:*.phase)` override. */
export interface SignalState {
  readonly phase: SignalPhase;
  readonly source: 'program' | 'override';
  readonly timingSource: 'map' | 'synthetic-default' | 'authored';
}

export interface StopLineBinding {
  readonly controlId: string;
  readonly kind: 'signal' | 'stop';
  readonly signalId: string | null;
  readonly dwellS: number;
  readonly rsl: LaneRsl;
  /** Arc length in the lane's **storage** direction. */
  readonly s: number;
  /** Empty means every movement; otherwise the route must contain one. */
  readonly connectingLaneRsls: readonly LaneRsl[];
}

export class SignalBook {
  private readonly programs: SignalProgram[];
  private readonly byId = new Map<string, SignalProgram>();
  private readonly cycleLength = new Map<string, number>();
  readonly stopLines: StopLineBinding[] = [];
  private readonly stopLinesByLane = new Map<LaneRsl, StopLineBinding[]>();
  private readonly overrides = new Map<string, SignalPhase>();

  constructor(
    programs: readonly SignalProgram[],
    private readonly warmupSeconds: number,
    roadControls: readonly RoadControl[] = [],
  ) {
    this.programs = [...programs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const p of this.programs) {
      this.byId.set(p.id, p);
      this.cycleLength.set(
        p.id,
        p.phases.reduce((sum, ph) => sum + ph.durationS, 0),
      );
      for (const sl of [...p.stopLines].sort((a, b) => (a.rsl < b.rsl ? -1 : a.rsl > b.rsl ? 1 : a.s - b.s))) {
        const binding: StopLineBinding = {
          controlId: p.id,
          kind: 'signal',
          signalId: p.id,
          dwellS: 0,
          rsl: sl.rsl,
          s: sl.s,
          connectingLaneRsls: [...sl.connectingLaneRsls].sort(),
        };
        this.stopLines.push(binding);
        const arr = this.stopLinesByLane.get(sl.rsl);
        if (arr) arr.push(binding);
        else this.stopLinesByLane.set(sl.rsl, [binding]);
      }
    }
    for (const control of [...roadControls].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const sl of [...control.stopLines].sort((a, b) => (a.rsl < b.rsl ? -1 : a.rsl > b.rsl ? 1 : a.s - b.s))) {
        const binding: StopLineBinding = {
          controlId: control.id,
          kind: 'stop',
          signalId: null,
          dwellS: control.dwellS,
          rsl: sl.rsl,
          s: sl.s,
          connectingLaneRsls: [...sl.connectingLaneRsls].sort(),
        };
        this.stopLines.push(binding);
        const arr = this.stopLinesByLane.get(sl.rsl);
        if (arr) arr.push(binding);
        else this.stopLinesByLane.set(sl.rsl, [binding]);
      }
    }
  }

  get isEmpty(): boolean {
    return this.stopLines.length === 0 && this.programs.length === 0;
  }

  ids(): string[] {
    return this.programs.map((p) => p.id);
  }

  /** Phase of `signalId` at simulation time `t` (which may be negative). */
  phaseAt(signalId: string, t: number): SignalPhase | null {
    return this.stateAt(signalId, t)?.phase ?? null;
  }

  /** Phase and provenance of `signalId` at simulation time `t`. */
  stateAt(signalId: string, t: number): SignalState | null {
    const forced = this.overrides.get(signalId);
    const p = this.byId.get(signalId);
    if (!p) return null;
    const timingSource = p.mapBinding?.timingSource ?? 'authored';
    if (forced) return { phase: forced, source: 'override', timingSource };
    const cycle = this.cycleLength.get(signalId)!;
    let elapsed = t + this.warmupSeconds + p.offsetS;
    if (p.loop) {
      elapsed = ((elapsed % cycle) + cycle) % cycle;
    } else if (elapsed < 0) {
      return { phase: p.phases[0]!.phase, source: 'program', timingSource };
    } else if (elapsed >= cycle) {
      return { phase: p.phases[p.phases.length - 1]!.phase, source: 'program', timingSource };
    }
    let acc = 0;
    for (const ph of p.phases) {
      acc += ph.durationS;
      if (elapsed < acc) return { phase: ph.phase, source: 'program', timingSource };
    }
    return { phase: p.phases[p.phases.length - 1]!.phase, source: 'program', timingSource };
  }

  /** Force a world signal phase through `set(signal:<id>.phase, ...)`. */
  setOverride(signalId: string, phase: SignalPhase | null): boolean {
    if (!this.byId.has(signalId)) return false;
    if (phase === null) this.overrides.delete(signalId);
    else this.overrides.set(signalId, phase);
    return true;
  }

  /** Stop lines on a lane, in storage-`s` order. */
  onLane(rsl: LaneRsl): readonly StopLineBinding[] {
    return this.stopLinesByLane.get(rsl) ?? [];
  }
}

/** May an actor enter the intersection on this phase? Yellow is treated as
 * "stop if you comfortably can", which the governor resolves with the
 * comfort-decel test rather than here. */
export function phaseForbidsEntry(phase: SignalPhase): boolean {
  // A dark/failed normal signal is uncontrolled. Flashing yellow is caution,
  // while flashing red retains stop semantics. Lane-use and human indications
  // share the same executable right-of-way boundary.
  return !['green', 'green_arrow', 'proceed', 'flashing_yellow', 'off'].includes(phase);
}
