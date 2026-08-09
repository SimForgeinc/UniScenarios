import { describe, expect, it } from "vitest";
import {
  assertCompleteSumoSignalSnapshot,
  assertCompleteSumoSignalTopology,
  decodeSumoSignalSnapshot,
  fitSumoSignalProgramsToScenario,
  parseSumoSignalTopology,
} from "./signalState";

const network = `
<net>
  <tlLogic id="junction-a" type="static" programID="0" offset="0">
    <phase duration="42" state="Grr"/>
    <phase duration="3" state="yrr"/>
    <phase duration="42" state="rGG"/>
    <phase duration="3" state="ryy"/>
    <param key="linkSignalID:0" value="head-1"/>
    <param key="linkSignalID:1" value="head-2 head-3"/>
  </tlLogic>
  <connection from="a" to="b" tl="junction-a" linkIndex="2"><param key="signalID" value="head-3"/></connection>
</net>`;

describe("SUMO physical traffic-light state", () => {
  it("maps controlled links to retained OpenDRIVE head ids", () => {
    const topology = parseSumoSignalTopology(network);
    expect(topology.mappedHeadIds).toEqual(["head-1", "head-2", "head-3"]);
    expect(
      topology.bindings.map(({ linkIndex, headIds }) => ({
        linkIndex,
        headIds,
      })),
    ).toEqual([
      { linkIndex: 0, headIds: ["head-1"] },
      { linkIndex: 1, headIds: ["head-2", "head-3"] },
      { linkIndex: 2, headIds: ["head-3"] },
    ]);
  });

  it("normalizes packed SUMO link states and reports unmapped links", () => {
    const topology = parseSumoSignalTopology(network);
    const hash = topology.bindings[0]!.controllerHash;
    const buffer = new ArrayBuffer(4 * 8);
    const view = new DataView(buffer);
    writeLink(view, 0, hash, 0, "r");
    writeLink(view, 1, hash, 1, "G");
    writeLink(view, 2, hash, 2, "r");
    writeLink(view, 3, 123, 0, "G");
    expect(decodeSumoSignalSnapshot(buffer, 4, topology)).toEqual({
      heads: { "head-1": "red", "head-2": "green", "head-3": "green" },
      mappedHeadCount: 3,
      unmappedLinkCount: 1,
    });
  });

  it("fits a complete red-to-green cycle inside a 20-second preview deterministically", () => {
    const first = fitSumoSignalProgramsToScenario(network, 20);
    const second = fitSumoSignalProgramsToScenario(network, 20);
    expect(first).toEqual(second);
    expect(first.adjustedControllers).toBe(1);
    const durations = [
      ...first.xml.matchAll(/<phase duration="([\d.]+)"/g),
    ].map((match) => Number(match[1]));
    expect(durations.reduce((sum, duration) => sum + duration, 0)).toBeCloseTo(
      18,
      1,
    );
    expect(durations[1]).toBe(2);
    expect(durations[3]).toBe(2);
  });

  it("is safe for maps without controlled signals", () => {
    const topology = parseSumoSignalTopology(
      '<net><junction id="plain"/></net>',
    );
    expect(topology).toEqual({
      bindings: [],
      mappedHeadIds: [],
      signalized: false,
      controlledLinkCount: 0,
    });
    expect(() => assertCompleteSumoSignalTopology(topology)).not.toThrow();
    expect(fitSumoSignalProgramsToScenario("<net/>", 20)).toEqual({
      xml: "<net/>",
      adjustedControllers: 0,
    });
    const snapshot = decodeSumoSignalSnapshot(new ArrayBuffer(0), 0, topology);
    expect(snapshot).toEqual({
      heads: {},
      mappedHeadCount: 0,
      unmappedLinkCount: 0,
    });
    expect(() =>
      assertCompleteSumoSignalSnapshot(topology, snapshot),
    ).not.toThrow();
  });

  it("fails closed when a signalized network has no physical-head provenance", () => {
    const topology = parseSumoSignalTopology(`
      <net>
        <tlLogic id="junction-a"><phase duration="30" state="Gr"/></tlLogic>
        <connection from="a" to="b" tl="junction-a" linkIndex="0"/>
      </net>`);
    expect(topology).toMatchObject({
      signalized: true,
      controlledLinkCount: 1,
      bindings: [],
    });
    expect(() => assertCompleteSumoSignalTopology(topology)).toThrow(
      "SUMO signal mapping is unavailable for a signalized network",
    );
  });

  it("fails closed when runtime controlled links are only partially mapped", () => {
    const topology = parseSumoSignalTopology(network);
    const hash = topology.bindings[0]!.controllerHash;
    const buffer = new ArrayBuffer(4 * 8);
    const view = new DataView(buffer);
    writeLink(view, 0, hash, 0, "r");
    writeLink(view, 1, hash, 1, "G");
    writeLink(view, 2, hash, 2, "r");
    writeLink(view, 3, 123, 0, "G");
    const snapshot = decodeSumoSignalSnapshot(buffer, 4, topology);
    expect(() => assertCompleteSumoSignalSnapshot(topology, snapshot)).toThrow(
      "SUMO signal mapping is incomplete (1 unmapped controlled links)",
    );
  });
});

function writeLink(
  view: DataView,
  index: number,
  hash: number,
  linkIndex: number,
  state: string,
): void {
  const offset = index * 8;
  view.setUint32(offset, hash, true);
  view.setUint16(offset + 4, linkIndex, true);
  view.setUint8(offset + 6, state.charCodeAt(0));
}
