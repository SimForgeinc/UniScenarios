/**
 * Deterministic syntax validator for the concrete OpenSCENARIO DSL 2.2
 * profile emitted by this package.
 *
 * The accepted statements are a strict subset of the official 2.2 grammar:
 * import-statement, scenario-declaration, parameter-declaration,
 * keep-constraint-declaration, do-directive/composition,
 * behavior-invocation, modifier-application, wait-directive and expressions.
 * Rejecting all other productions is intentional: this is an exporter gate,
 * not a general-purpose OpenSCENARIO compiler.
 */

export interface Dsl22SyntaxDiagnostic {
  readonly line: number;
  readonly column: number;
  readonly reason: string;
}

export class Dsl22SyntaxError extends Error {
  override readonly name = 'Dsl22SyntaxError';
  readonly diagnostics: readonly Dsl22SyntaxDiagnostic[];

  constructor(diagnostics: readonly Dsl22SyntaxDiagnostic[]) {
    super(`OpenSCENARIO DSL 2.2 profile syntax rejected ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}`);
    this.diagnostics = diagnostics;
  }
}

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_]*';
const FIELD = `${IDENTIFIER}(?:\\.${IDENTIFIER})*`;
const NUMBER = '-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?';
const PHYSICAL = `${NUMBER}(?:m|s|rad|mps|mpss)`;
const VALUE = `(?:${PHYSICAL}|${NUMBER}|true|false|${FIELD}|"(?:[^"\\\\]|\\\\.)*")`;

const statements: readonly RegExp[] = [
  new RegExp(`^import ${FIELD}$`),
  new RegExp(`^scenario ${IDENTIFIER}:$`),
  new RegExp(`^${IDENTIFIER}: (?:map|vehicle|person|animal|stationary_object|pose_3d) with:$`),
  new RegExp(`^${IDENTIFIER}: path = ${FIELD}\\.create_path\\(points: \\[${IDENTIFIER}(?:, ${IDENTIFIER})+\\], interpolation: straight_line\\)$`),
  /^keep\(.+\)$/,
  new RegExp(`^${FIELD}\\.location\\(pose: ${IDENTIFIER}\\)$`),
  new RegExp(`^do parallel\\(duration: ${PHYSICAL}\\):$`),
  /^serial:$/,
  new RegExp(`^wait elapsed\\(${PHYSICAL}\\)$`),
  new RegExp(`^${FIELD}\\.${IDENTIFIER}\\((?:[^()"']|"(?:[^"\\\\]|\\\\.)*")*\\)(?: with:)?$`),
  new RegExp(`^${IDENTIFIER}\\((?:${IDENTIFIER}: ${VALUE})(?:, ${IDENTIFIER}: ${VALUE})*\\)$`),
];

function contentWithoutComment(line: string): string | null {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') quoted = !quoted;
    if (char === '#' && !quoted) return line.slice(0, index).trimEnd() || null;
  }
  return line.trimEnd() || null;
}

function balanced(line: string): string | null {
  const stack: string[] = [];
  let quoted = false;
  let escaped = false;
  const closes: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' };
  for (const char of line) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '(' || char === '[' || char === '{') stack.push(char);
    else if (char in closes && stack.pop() !== closes[char]) return `unmatched ${char}`;
  }
  if (quoted) return 'unterminated string literal';
  return stack.length > 0 ? `unclosed ${stack.at(-1)}` : null;
}

export function validateOpenScenarioDsl22ProfileSyntax(source: string): readonly Dsl22SyntaxDiagnostic[] {
  const diagnostics: Dsl22SyntaxDiagnostic[] = [];
  if (source.includes('\r')) diagnostics.push({ line: 1, column: 1, reason: 'only LF line endings are accepted' });
  const activeIndents = [0];
  let previous: { indent: number; opensBlock: boolean; line: number } | null = null;
  let sawImport = false;
  let sawScenario = false;

  for (const [offset, raw] of source.split('\n').entries()) {
    const lineNumber = offset + 1;
    if (raw.includes('\t')) {
      diagnostics.push({ line: lineNumber, column: raw.indexOf('\t') + 1, reason: 'tabs are not valid indentation in the concrete profile' });
      continue;
    }
    const visible = contentWithoutComment(raw);
    if (visible === null) continue;
    const indent = visible.length - visible.trimStart().length;
    const text = visible.trimStart();
    if (indent % 4 !== 0) diagnostics.push({ line: lineNumber, column: 1, reason: 'indentation must use four-space levels' });

    if (previous && indent > previous.indent) {
      if (!previous.opensBlock) diagnostics.push({ line: lineNumber, column: 1, reason: `unexpected indentation after line ${previous.line}` });
      activeIndents.push(indent);
    } else if (indent < activeIndents.at(-1)!) {
      while (activeIndents.length > 1 && indent < activeIndents.at(-1)!) activeIndents.pop();
      if (indent !== activeIndents.at(-1)) diagnostics.push({ line: lineNumber, column: 1, reason: 'dedent does not match an enclosing block' });
    }

    const bracketIssue = balanced(text);
    if (bracketIssue) diagnostics.push({ line: lineNumber, column: 1, reason: bracketIssue });
    if (!statements.some((statement) => statement.test(text))) {
      diagnostics.push({ line: lineNumber, column: indent + 1, reason: `statement is outside the generated DSL 2.2 grammar profile: ${text}` });
    }

    if (text.startsWith('import ')) {
      if (indent !== 0 || sawScenario) diagnostics.push({ line: lineNumber, column: 1, reason: 'imports must precede the top-level scenario' });
      sawImport = true;
    } else if (text.startsWith('scenario ')) {
      if (indent !== 0 || sawScenario) diagnostics.push({ line: lineNumber, column: 1, reason: 'exactly one top-level scenario is allowed' });
      sawScenario = true;
    } else if (!sawScenario) {
      diagnostics.push({ line: lineNumber, column: 1, reason: 'scenario declaration must precede scenario members' });
    }
    previous = { indent, opensBlock: text.endsWith(':'), line: lineNumber };
  }

  if (!sawImport) diagnostics.push({ line: 1, column: 1, reason: 'missing standard-library import' });
  if (!sawScenario) diagnostics.push({ line: 1, column: 1, reason: 'missing scenario declaration' });
  if (previous?.opensBlock) diagnostics.push({ line: previous.line, column: previous.indent + 1, reason: 'block has no body' });
  return diagnostics;
}

export function assertOpenScenarioDsl22ProfileSyntax(source: string): void {
  const diagnostics = validateOpenScenarioDsl22ProfileSyntax(source);
  if (diagnostics.length > 0) throw new Dsl22SyntaxError(diagnostics);
}
