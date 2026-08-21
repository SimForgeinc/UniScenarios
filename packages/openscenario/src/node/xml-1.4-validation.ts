import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

/** Immutable identity of the official ASAM OpenSCENARIO XML 1.4.0 deliverable. */
export const OFFICIAL_OPENSCENARIO_140_XSD = {
  version: '1.4.0',
  url: 'https://publications.pages.asam.net/standards/ASAM_OpenSCENARIO/ASAM_OpenSCENARIO_XML/v1.4.0/_attachments/generated/ASAM_OpenSCENARIO_v1.4.0_Schema.zip',
  archiveSha256: 'efbb2da3432ef8bb9f87daa9d710fb20a2ad65276bc386d28885a5fe9511a39c',
  xsdSha256: '949fe2bcebd1f3fdb941a2cc56641482737ab48e3c5b0eed0ee5294b2355c0e9',
} as const;

export interface OpenScenarioXml14Validation {
  readonly valid: boolean;
  readonly standard: 'ASAM OpenSCENARIO XML 1.4.0';
  readonly xsdSha256: string;
  readonly diagnostics: readonly string[];
}

const XML_EXTERNAL_DECLARATION = /<!\s*(?:DOCTYPE|ENTITY)\b/iu;

/**
 * Validate native XML 1.4 output against the digest-pinned official schema.
 *
 * This intentionally does not download anything: release/CI setup obtains the
 * ASAM archive, verifies the archive digest, and passes the extracted XSD path.
 * The XML parser is network-disabled and DTD/entity declarations are rejected
 * before libxml2 sees the document.
 */
export async function validateOpenScenarioXml14(
  xml: string,
  xsdPath: string,
): Promise<OpenScenarioXml14Validation> {
  if (!existsSync(xsdPath)) throw new Error(`OpenSCENARIO 1.4.0 XSD not found: ${xsdPath}`);
  const xsdBytes = new Uint8Array(await readFile(xsdPath));
  const xsdSha256 = createHash('sha256').update(xsdBytes).digest('hex');
  if (xsdSha256 !== OFFICIAL_OPENSCENARIO_140_XSD.xsdSha256) {
    throw new Error(`OpenSCENARIO 1.4.0 XSD digest mismatch: expected ${OFFICIAL_OPENSCENARIO_140_XSD.xsdSha256}, got ${xsdSha256}`);
  }
  if (XML_EXTERNAL_DECLARATION.test(xml)) return {
    valid: false,
    standard: 'ASAM OpenSCENARIO XML 1.4.0',
    xsdSha256,
    diagnostics: ['DTD and entity declarations are forbidden in OpenSCENARIO validation input'],
  };
  return new Promise((resolve, reject) => {
    const child = spawn('xmllint', ['--nonet', '--noout', '--schema', xsdPath, '-'], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({
      valid: code === 0,
      standard: 'ASAM OpenSCENARIO XML 1.4.0',
      xsdSha256,
      diagnostics: stderr.split('\n').map((line) => line.trim()).filter(Boolean),
    }));
    child.stdin.end(xml);
  });
}
