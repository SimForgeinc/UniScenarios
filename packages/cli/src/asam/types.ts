import type {
  Interaction,
  LaneGraph,
  Pose,
  Route,
  SimActor,
  SimScenarioInput,
} from '@uniscenarios/sim-engine';

export const ASAM_FORMATS = ['xosc-1.4', 'osc-2.2'] as const;
export type AsamFormat = (typeof ASAM_FORMATS)[number];

export interface AsamExportIssue {
  readonly code: string;
  readonly path: string;
  readonly reason: string;
}

export interface AsamExportWarning extends AsamExportIssue {}

export class AsamExportError extends Error {
  override readonly name = 'AsamExportError';
  readonly issues: readonly AsamExportIssue[];

  constructor(issues: readonly AsamExportIssue[]) {
    super(`ASAM export rejected ${issues.length} unsupported or invalid feature${issues.length === 1 ? '' : 's'}`);
    this.issues = issues;
  }
}

export interface AsamExportOptions {
  /** The concrete map graph used to turn every engine route into world coordinates. */
  readonly graph: LaneGraph;
  /** Logical road file referenced by XML 1.4. Defaults to `<mapId>.xodr`. */
  readonly roadFile?: string | undefined;
  /** Deterministic header timestamp. Defaults to the Unix epoch. */
  readonly headerDate?: string | undefined;
  readonly author?: string | undefined;
  readonly description?: string | undefined;
  /** Maximum distance between exported route waypoints. */
  readonly routeSampleM?: number | undefined;
}

export interface AsamExportResult {
  readonly format: AsamFormat;
  readonly standard: 'ASAM OpenSCENARIO XML 1.4.0' | 'ASAM OpenSCENARIO DSL 2.2.0';
  readonly extension: '.xosc' | '.osc';
  readonly mediaType: 'application/xml' | 'text/plain';
  readonly content: string;
  readonly warnings: readonly AsamExportWarning[];
}

export interface ResolvedActor {
  readonly actor: SimActor;
  readonly name: string;
  readonly routeName: string;
  readonly route: Route;
  readonly points: readonly Pose[];
}

export interface ResolvedInteraction {
  readonly interaction: Interaction;
  readonly name: string;
  readonly startTimeS?: number | undefined;
}

export interface ResolvedAsamScenario {
  readonly input: SimScenarioInput;
  readonly actors: readonly ResolvedActor[];
  readonly interactions: readonly ResolvedInteraction[];
  readonly actorNames: ReadonlyMap<string, string>;
  readonly interactionNames: ReadonlyMap<string, string>;
  readonly warnings: readonly AsamExportWarning[];
}
