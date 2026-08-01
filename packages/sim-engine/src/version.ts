/**
 * Engine version. Bump on any change that can move a trace byte — controller
 * gains, integration order, quantisation, metric definitions. Traces carry it
 * so a cached artefact from an older engine is never silently trusted.
 */
export const ENGINE_VERSION = '0.1.0';
