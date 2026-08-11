/**
 * Engine version. Bump on any change that can move a trace byte — controller
 * gains, integration order, quantisation, metric definitions. Traces carry it
 * so a cached artefact from an older engine is never silently trusted.
 */
// 0.3.0 is the provenance boundary where omitted physics begins a new
// dynamic-v1 simulation. Earlier recorded traces retain kinematic semantics.
// 0.4.0 adds deterministic rigid-body contact response and impulse telemetry;
// immutable 0.3 traces remain readable under trace format v2. 0.5.0 adds
// exact-time authored trajectories with collision-triggered physics handoff.
export const ENGINE_VERSION = '0.5.0';
