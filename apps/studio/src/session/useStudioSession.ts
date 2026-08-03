import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { EditorController } from '../editor/controller';
import { initialSession, reduceSession, canMutate, shouldPreparePlayback, type StudioSessionState } from './model';
import { handleTransportKey } from './keyboard';
import { PreparationGate } from './preparationGate';

export interface StudioSessionApi {
  readonly state: StudioSessionState;
  readonly playPause: () => void;
  readonly stop: () => void;
  readonly seek: (time: number) => void;
}

export interface StudioSessionOptions {
  /** Build the immutable concrete input + trace before entering playback. */
  prepare?: (signal: AbortSignal) => Promise<void>;
  /** Immediately cancel preparation and discard derived playback artifacts. */
  cancel?: () => void;
  /** Another transport (for example an imported verified trace) owns Space. */
  keyboardEnabled?: boolean;
  /** Latest recorded live tick; seeking beyond it would inspect invented time. */
  seekLimit?: () => number;
}

export function useStudioSession(
  controller: EditorController | null,
  duration: number,
  options: StudioSessionOptions = {},
): StudioSessionApi {
  const [state, dispatch] = useReducer(reduceSession, duration, initialSession);
  const frame = useRef(0);
  const preparation = useRef(new PreparationGate());
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    controller?.setAuthoringEnabled(canMutate(state.mode));
    return () => controller?.setAuthoringEnabled(true);
  }, [controller, state.mode]);

  useEffect(() => {
    if (state.mode !== 'playing') return;
    const wallStart = performance.now();
    const traceStart = state.time;
    const tick = (now: number): void => {
      dispatch({ type: 'clock', time: traceStart + Math.max(0, (now - wallStart) / 1000) });
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [state.mode]);

  useEffect(() => {
    if (state.mode === 'authoring' && state.duration !== duration) {
      dispatch({ type: 'stop' });
    }
  }, [duration, state.duration, state.mode]);

  const playPause = useCallback(() => {
    if (!controller) return;
    // A failed preparation must not leave a visually enabled Play button that
    // can never do anything.  Retrying uses the current editor document, so a
    // corrected binding/interaction can be played immediately without an
    // otherwise mysterious Escape-reset first.
    if (shouldPreparePlayback(state.mode)) {
      dispatch({ type: 'prepare', duration });
      const ticket = preparation.current.begin();
      void Promise.resolve().then(async () => {
        if (!preparation.current.isCurrent(ticket)) return;
        const report = controller.doc.validation;
        if (!report.ok) {
          const errors = report.issues.filter((item) => item.severity === 'error').slice(0, 3);
          throw new Error(errors.map((item) => item.message).join(' · ') || 'Scenario is invalid');
        }
        await optionsRef.current.prepare?.(ticket.signal);
        if (!preparation.current.complete(ticket)) return;
        // One atomic transition latches the initiating Play intent across an
        // asynchronous cold prepare. Separate ready/play dispatches can be
        // observed as paused by playback mounting effects in the same commit.
        dispatch({ type: 'ready-and-play' });
      }).catch((reason: unknown) => {
        if (!preparation.current.isCurrent(ticket)) return;
        dispatch({ type: 'fail', message: reason instanceof Error ? reason.message : String(reason) });
      });
      return;
    }
    dispatch({ type: state.mode === 'playing' ? 'pause' : 'play' });
  }, [controller, duration, state.mode]);

  const stop = useCallback(() => {
    preparation.current.cancel();
    optionsRef.current.cancel?.();
    dispatch({ type: 'stop' });
  }, []);

  useEffect(() => () => {
    preparation.current.cancel();
    optionsRef.current.cancel?.();
  }, [controller]);

  useEffect(() => {
    if (options.keyboardEnabled === false) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      handleTransportKey(event, state.mode, playPause, stop);
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [options.keyboardEnabled, playPause, state.mode, stop]);

  return {
    state,
    playPause,
    stop,
    seek: useCallback((time: number) => {
      const limit = optionsRef.current.seekLimit?.() ?? duration;
      dispatch({ type: 'seek', time: Math.min(time, limit) });
    }, [duration]),
  };
}
