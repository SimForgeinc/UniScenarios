export type NormalizedTrafficLightPhase = "green" | "yellow" | "red" | "off";

export interface SumoSignalLinkBinding {
  readonly controllerHash: number;
  readonly controllerId: string;
  readonly linkIndex: number;
  readonly headIds: readonly string[];
}

export interface SumoSignalTopology {
  readonly bindings: readonly SumoSignalLinkBinding[];
  readonly mappedHeadIds: readonly string[];
  readonly signalized: boolean;
  readonly controlledLinkCount: number;
}

export interface NormalizedSignalSnapshot {
  readonly heads: Readonly<Record<string, NormalizedTrafficLightPhase>>;
  readonly mappedHeadCount: number;
  readonly unmappedLinkCount: number;
}

/**
 * Extracts the OpenDRIVE physical-head provenance retained by netconvert.
 * SUMO 1.27 emits `linkSignalID:<index>` params on tlLogic. Older converted
 * assets may only retain the same `signalID` param on controlled connections,
 * so both forms are accepted and merged deterministically.
 */
export function parseSumoSignalTopology(
  networkXml: string,
): SumoSignalTopology {
  const byLink = new Map<
    string,
    { controllerId: string; linkIndex: number; headIds: Set<string> }
  >();
  const controlledLinks = new Set<string>();
  for (const match of networkXml.matchAll(
    /<tlLogic\b([^>]*)>([\s\S]*?)<\/tlLogic>/g,
  )) {
    const controllerId = decodeXml(attribute(match[1]!, "id") ?? "");
    if (!controllerId) continue;
    for (const param of match[2]!.matchAll(/<param\b([^>]*)\/?\s*>/g)) {
      const key = decodeXml(attribute(param[1]!, "key") ?? "");
      const linkIndex = Number(/^linkSignalID:(\d+)$/.exec(key)?.[1]);
      if (!Number.isInteger(linkIndex)) continue;
      addBinding(
        byLink,
        controllerId,
        linkIndex,
        decodeIds(attribute(param[1]!, "value")),
      );
    }
  }
  for (const match of networkXml.matchAll(
    /<connection\b([^>]*)>([\s\S]*?)<\/connection>/g,
  )) {
    const controllerId = decodeXml(attribute(match[1]!, "tl") ?? "");
    const linkIndex = Number(attribute(match[1]!, "linkIndex"));
    if (!controllerId || !Number.isInteger(linkIndex)) continue;
    controlledLinks.add(`${controllerId}:${linkIndex}`);
    for (const param of match[2]!.matchAll(/<param\b([^>]*)\/?\s*>/g)) {
      if (attribute(param[1]!, "key") !== "signalID") continue;
      addBinding(
        byLink,
        controllerId,
        linkIndex,
        decodeIds(attribute(param[1]!, "value")),
      );
    }
  }
  for (const match of networkXml.matchAll(/<connection\b([^>]*)\/>/g)) {
    const controllerId = decodeXml(attribute(match[1]!, "tl") ?? "");
    const linkIndex = Number(attribute(match[1]!, "linkIndex"));
    if (controllerId && Number.isInteger(linkIndex)) {
      controlledLinks.add(`${controllerId}:${linkIndex}`);
    }
  }
  const bindings = [...byLink.values()]
    .filter((binding) => binding.headIds.size > 0)
    .map((binding) => ({
      controllerHash: fnv1a(binding.controllerId),
      controllerId: binding.controllerId,
      linkIndex: binding.linkIndex,
      headIds: [...binding.headIds].sort(),
    }))
    .sort(
      (left, right) =>
        left.controllerId.localeCompare(right.controllerId) ||
        left.linkIndex - right.linkIndex,
    );
  return {
    bindings,
    mappedHeadIds: [
      ...new Set(bindings.flatMap((binding) => binding.headIds)),
    ].sort(),
    signalized: /<tlLogic\b/.test(networkXml) || controlledLinks.size > 0,
    controlledLinkCount: controlledLinks.size,
  };
}

export function assertCompleteSumoSignalTopology(
  topology: SumoSignalTopology,
): void {
  if (!topology.signalized) return;
  if (topology.bindings.length === 0 || topology.mappedHeadIds.length === 0) {
    throw new Error(
      "SUMO signal mapping is unavailable for a signalized network",
    );
  }
}

export function assertCompleteSumoSignalSnapshot(
  topology: SumoSignalTopology,
  snapshot: NormalizedSignalSnapshot,
): void {
  if (!topology.signalized) return;
  if (snapshot.mappedHeadCount === 0 || snapshot.unmappedLinkCount > 0) {
    throw new Error(
      `SUMO signal mapping is incomplete (${snapshot.unmappedLinkCount} unmapped controlled links)`,
    );
  }
}

/**
 * Fit imported signal cycles inside a scenario preview window. This is the
 * deterministic fallback used when no authored signal program is supplied.
 * It changes the exact network given to SUMO, so vehicles and visible heads
 * remain governed by one authority. Clearance phases retain safe minima.
 */
export function fitSumoSignalProgramsToScenario(
  networkXml: string,
  scenarioSeconds = 20,
): { readonly xml: string; readonly adjustedControllers: number } {
  const targetCycle = Math.max(8, scenarioSeconds - 2);
  let adjustedControllers = 0;
  const xml = networkXml.replace(
    /(<tlLogic\b[^>]*>)([\s\S]*?)(<\/tlLogic>)/g,
    (whole, open: string, body: string, close: string) => {
      const phases = [...body.matchAll(/<phase\b([^>]*)\/?\s*>/g)].map(
        (match) => ({
          whole: match[0],
          attrs: match[1]!,
          duration: Number(attribute(match[1]!, "duration")),
          state: attribute(match[1]!, "state") ?? "",
        }),
      );
      const total = phases.reduce((sum, phase) => sum + phase.duration, 0);
      if (
        phases.length < 2 ||
        !(total > targetCycle) ||
        phases.some((phase) => !(phase.duration > 0))
      )
        return whole;
      const clearance = phases.map((phase) =>
        phase.state.includes("y") || phase.state.includes("Y")
          ? 2
          : /^[rso]+$/i.test(phase.state)
            ? 1
            : 0,
      );
      const active = phases.map((phase, index) =>
        clearance[index] === 0 ? phase.duration : 0,
      );
      const activeTotal = active.reduce((sum, duration) => sum + duration, 0);
      const remaining =
        targetCycle -
        clearance.reduce<number>((sum, duration) => sum + duration, 0);
      if (
        !(activeTotal > 0) ||
        remaining < active.filter((duration) => duration > 0).length * 2
      )
        return whole;
      let phaseIndex = 0;
      const nextBody = body.replace(
        /<phase\b([^>]*)\/?\s*>/g,
        (phaseXml: string) => {
          const index = phaseIndex++;
          const duration =
            clearance[index]! || (remaining * active[index]!) / activeTotal;
          return phaseXml.replace(
            /duration="[^"]*"/,
            `duration="${formatDuration(duration)}"`,
          );
        },
      );
      adjustedControllers += 1;
      return `${open}${nextBody}${close}`;
    },
  );
  return { xml, adjustedControllers };
}

export function decodeSumoSignalSnapshot(
  buffer: ArrayBuffer,
  linkCount: number,
  topology: SumoSignalTopology,
): NormalizedSignalSnapshot {
  const links = new Map<string, NormalizedTrafficLightPhase>();
  const view = new DataView(buffer);
  for (let index = 0; index < linkCount; index += 1) {
    const offset = index * 8;
    if (offset + 8 > view.byteLength) break;
    const controllerHash = view.getUint32(offset, true);
    const linkIndex = view.getUint16(offset + 4, true);
    links.set(
      `${controllerHash}:${linkIndex}`,
      phaseFromSumoState(view.getUint8(offset + 6)),
    );
  }
  const candidates = new Map<string, NormalizedTrafficLightPhase[]>();
  let mappedLinks = 0;
  for (const binding of topology.bindings) {
    const phase = links.get(`${binding.controllerHash}:${binding.linkIndex}`);
    if (!phase) continue;
    mappedLinks += 1;
    for (const headId of binding.headIds) {
      const list = candidates.get(headId) ?? [];
      list.push(phase);
      candidates.set(headId, list);
    }
  }
  const heads: Record<string, NormalizedTrafficLightPhase> = {};
  for (const [headId, phases] of candidates)
    heads[headId] = aggregatePhases(phases);
  return {
    heads,
    mappedHeadCount: Object.keys(heads).length,
    unmappedLinkCount: Math.max(0, linkCount - mappedLinks),
  };
}

function phaseFromSumoState(code: number): NormalizedTrafficLightPhase {
  const state = String.fromCharCode(code);
  if (state === "G" || state === "g") return "green";
  if (state === "Y" || state === "y") return "yellow";
  if (state === "R" || state === "r") return "red";
  return "off";
}

function aggregatePhases(
  phases: readonly NormalizedTrafficLightPhase[],
): NormalizedTrafficLightPhase {
  // One physical face may be provenance for multiple permitted movements.
  // Showing green when any bound movement is open best represents the face;
  // otherwise retain yellow before red, and fail dark for unknown states.
  if (phases.includes("green")) return "green";
  if (phases.includes("yellow")) return "yellow";
  if (phases.includes("red")) return "red";
  return "off";
}

function addBinding(
  bindings: Map<
    string,
    { controllerId: string; linkIndex: number; headIds: Set<string> }
  >,
  controllerId: string,
  linkIndex: number,
  headIds: readonly string[],
): void {
  if (headIds.length === 0) return;
  const key = `${controllerId}:${linkIndex}`;
  const binding = bindings.get(key) ?? {
    controllerId,
    linkIndex,
    headIds: new Set<string>(),
  };
  for (const headId of headIds) binding.headIds.add(headId);
  bindings.set(key, binding);
}

function decodeIds(value: string | undefined): string[] {
  return decodeXml(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function attribute(source: string, name: string): string | undefined {
  return source.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function fnv1a(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function formatDuration(value: number): string {
  return Math.max(0.1, value)
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}
