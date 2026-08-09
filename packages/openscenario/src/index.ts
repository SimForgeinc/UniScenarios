/**
 * Stable public OpenSCENARIO API for UniScenarios.
 *
 * The implementation currently lives with the CLI so command-line and library
 * exports cannot drift. Consumers should import this package; the implementation
 * can move behind this boundary without changing their code.
 */
export * from '@uniscenarios/cli/asam';
