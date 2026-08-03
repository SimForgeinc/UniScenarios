export interface PreparationTicket {
  readonly generation: number;
  readonly signal: AbortSignal;
}

/** Owns one Play preparation attempt across renders and async boundaries. */
export class PreparationGate {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): PreparationTicket {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    return { generation: ++this.generation, signal: controller.signal };
  }

  isCurrent(ticket: PreparationTicket): boolean {
    return ticket.generation === this.generation && !ticket.signal.aborted;
  }

  cancel(): void {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
  }

  complete(ticket: PreparationTicket): boolean {
    if (!this.isCurrent(ticket)) return false;
    this.controller = null;
    return true;
  }
}

export function throwIfPreparationAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Playback preparation was canceled', 'AbortError');
}
