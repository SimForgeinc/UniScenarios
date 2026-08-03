export type InstantiateWasm = (
  imports: WebAssembly.Imports,
  successCallback: (instance: WebAssembly.Instance) => void,
) => void;

/**
 * Compile explicitly so Emscripten never enters its worker-side
 * instantiateStreaming(fetch(...)) path. The returned hook instantiates
 * synchronously inside Emscripten's promise executor, so failures reject
 * instead of leaving initialization pending forever.
 */
export async function compileSumoRuntime(binary: ArrayBuffer | undefined): Promise<InstantiateWasm | undefined> {
  if (!binary) return undefined;
  const compiled = await WebAssembly.compile(binary);
  return (imports, successCallback) => successCallback(new WebAssembly.Instance(compiled, imports));
}
