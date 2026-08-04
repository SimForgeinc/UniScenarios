const LEGACY_VALIDATE_IDS = new Set([
  'validate',
  'validate-export',
  'validate-and-export',
  'scenario-actions',
]);

export function workspaceForLegacySelection(selection: string | null | undefined): 'openscenario' | null {
  if (!selection) return null;
  const normalized = selection.trim().toLowerCase().replace(/^#/, '');
  return normalized === 'openscenario' || LEGACY_VALIDATE_IDS.has(normalized) ? 'openscenario' : null;
}

export function openScenarioLocationIntent(location: Pick<Location, 'search' | 'hash'>): {
  open: boolean;
  section: 'overview' | 'validation';
  canonicalSearch: string | null;
  canonicalHash: string | null;
} {
  const params = new URLSearchParams(location.search);
  const candidates = [params.get('workspace'), params.get('panel'), params.get('tool'), location.hash];
  const selected = candidates.find((value) => workspaceForLegacySelection(value) === 'openscenario');
  if (!selected) return { open: false, section: 'overview', canonicalSearch: null, canonicalHash: null };

  const legacy = workspaceForLegacySelection(selected) === 'openscenario'
    && selected.trim().toLowerCase().replace(/^#/, '') !== 'openscenario';
  if (!legacy) return { open: true, section: params.get('section') === 'validation' ? 'validation' : 'overview', canonicalSearch: null, canonicalHash: null };

  params.set('workspace', 'openscenario');
  params.set('section', 'validation');
  for (const key of ['panel', 'tool']) {
    if (workspaceForLegacySelection(params.get(key)) === 'openscenario') params.delete(key);
  }
  return {
    open: true,
    section: 'validation',
    canonicalSearch: params.toString() ? `?${params.toString()}` : '',
    canonicalHash: workspaceForLegacySelection(location.hash) === 'openscenario' ? '' : location.hash,
  };
}
