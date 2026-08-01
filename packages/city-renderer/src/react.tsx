import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CityViewer } from './viewer';
import type { CityViewerOptions } from './types';

export interface CityViewProps {
  /** Manifest URL, relative to `options.baseUrl` when set. */
  manifestUrl: string;
  options?: CityViewerOptions;
  className?: string;
  style?: CSSProperties;
  /** Called once the viewer exists — before the map has finished streaming. */
  onReady?: (viewer: CityViewer) => void;
  onError?: (error: unknown) => void;
}

const CANVAS_STYLE: CSSProperties = { display: 'block', width: '100%', height: '100%' };

/**
 * Thin React wrapper: mounts a {@link CityViewer} on a canvas and disposes it
 * on unmount. All interaction stays on the viewer instance handed to `onReady`.
 */
export function CityView({
  manifestUrl,
  options,
  className,
  style,
  onReady,
  onError,
}: CityViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<unknown>(null);
  // Options are read once at mount; changing them later requires a remount.
  const optionsRef = useRef(options);
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  onReadyRef.current = onReady;
  onErrorRef.current = onError;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new CityViewer(canvas, optionsRef.current);
    onReadyRef.current?.(viewer);
    viewer.loadMap(manifestUrl).catch((err: unknown) => {
      setError(err);
      onErrorRef.current?.(err);
      console.error('[city-renderer] loadMap failed', err);
    });
    return () => viewer.dispose();
  }, [manifestUrl]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ ...CANVAS_STYLE, ...style }}
      data-error={error ? String(error) : undefined}
    />
  );
}
