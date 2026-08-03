import type { StudioSessionMode } from './model';

export interface TransportKeyboardEvent {
  readonly key: string;
  readonly code?: string;
  readonly repeat?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly altKey?: boolean;
  readonly target: EventTarget | null;
  preventDefault(): void;
}

/** Space owns transport everywhere except editable controls. */
export function handleTransportKey(
  event: TransportKeyboardEvent,
  mode: StudioSessionMode,
  toggle: () => void,
  stop: () => void = () => undefined,
): boolean {
  if (event.key === 'Escape') {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return false;
    // In authoring mode Escape still belongs to editor tools/selections. Once
    // playback has begun it is an immediate local stop/reset, never navigation.
    if (mode === 'authoring') return false;
    event.preventDefault();
    stop();
    return true;
  }
  if (event.key !== ' ' && event.code !== 'Space') return false;
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return false;
  // Once Space belongs to transport it must never scroll the page, including
  // while an async preparation or a failed run is intentionally non-toggleable.
  event.preventDefault();
  if (mode === 'preparing' || mode === 'error') return true;
  toggle();
  return true;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const node = target as { tagName?: unknown; isContentEditable?: unknown; closest?: unknown };
  const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true) return true;
  if (typeof node.closest === 'function') {
    return Boolean((node.closest as (selector: string) => unknown)('input, textarea, select, [contenteditable="true"]'));
  }
  return false;
}
