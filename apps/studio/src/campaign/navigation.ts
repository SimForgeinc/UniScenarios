/** A pending catalog open may only mutate the editor owned by its target map. */
export function canApplyCampaignOpen(
  requestMapId: string | undefined,
  activeMapId: string,
  editorMapId: string,
): boolean {
  return requestMapId !== undefined
    && requestMapId === activeMapId
    && requestMapId === editorMapId;
}
