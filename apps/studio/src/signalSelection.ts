import {
  selectSignalReference,
  type SignalControlIndex,
  type SignalReferenceSelection,
} from '@uniscenarios/scenario-materializer';

export type SignalSelectionListener = (selection: SignalReferenceSelection | null) => void;

/** Small framework-neutral store shared by viewport picking and TimelineDock.
 * The map index remains immutable; only the selected reference changes. */
export class StudioSignalSelectionModel {
  private current: SignalReferenceSelection | null = null;
  private readonly listeners = new Set<SignalSelectionListener>();

  constructor(private index: SignalControlIndex) {}

  get snapshot(): SignalReferenceSelection | null {
    return this.current;
  }

  setIndex(index: SignalControlIndex): void {
    this.index = index;
    if (this.current) this.selectHead(this.current.selectedHeadId, this.current.referenceMovementId);
  }

  selectHead(headId: string, preferredMovementId?: string): SignalReferenceSelection | null {
    const next = selectSignalReference(this.index, headId, preferredMovementId);
    if (sameSelection(this.current, next)) return this.current;
    this.current = next;
    for (const listener of this.listeners) listener(next);
    return next;
  }

  clear(): void {
    if (!this.current) return;
    this.current = null;
    for (const listener of this.listeners) listener(null);
  }

  subscribe(listener: SignalSelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function sameSelection(a: SignalReferenceSelection | null, b: SignalReferenceSelection | null): boolean {
  return a?.selectedHeadId === b?.selectedHeadId && a?.referenceMovementId === b?.referenceMovementId;
}
