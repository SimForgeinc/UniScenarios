import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { STARTER_QUALITY_CHOICES, type QualityPresetId } from './quality';

export function FirstRunGraphicsChooser({
  onChoose,
}: {
  onChoose: (preset: Exclude<QualityPresetId, 'custom'>) => void;
}): JSX.Element {
  const choices = useRef<Array<HTMLButtonElement | null>>([]);
  const dialog = useRef<HTMLElement | null>(null);

  useEffect(() => { dialog.current?.focus(); }, []);

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? -1
        : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + STARTER_QUALITY_CHOICES.length) % STARTER_QUALITY_CHOICES.length;
    choices.current[next]?.focus();
  };

  return (
    <main className="graphics-onboarding" style={styles.page}>
      <style>{`
        .graphics-choice { transition: border-color 120ms ease, background-color 120ms ease, transform 120ms ease; }
        .graphics-onboarding-card:focus { outline: none; }
        .graphics-choice:hover { border-color: rgba(240,127,47,.72) !important; background: rgba(36,40,47,.98) !important; transform: translateY(-1px); }
        .graphics-choice:focus-visible { outline: 3px solid #ffad70; outline-offset: 3px; border-color: #f07f2f !important; }
        @media (max-width: 720px) {
          .graphics-onboarding-card { padding: 24px 18px !important; }
          .graphics-choice-grid { grid-template-columns: 1fr !important; }
        }
        @media (prefers-reduced-motion: reduce) {
          .graphics-choice { transition: none !important; }
          .graphics-choice:hover { transform: none; }
        }
      `}</style>
      <section
        ref={dialog}
        tabIndex={-1}
        className="graphics-onboarding-card"
        style={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="graphics-onboarding-title"
        aria-describedby="graphics-onboarding-description graphics-onboarding-method"
        data-testid="first-run-graphics-chooser"
      >
        <div style={styles.eyebrow}>WELCOME TO UNISCENARIOS</div>
        <h1 id="graphics-onboarding-title" style={styles.title}>Choose your graphics</h1>
        <p id="graphics-onboarding-description" style={styles.intro}>
          Pick a starting point for this browser. You can change it later in Settings.
        </p>
        <div className="graphics-choice-grid" style={styles.grid} aria-label="Graphics quality options">
          {STARTER_QUALITY_CHOICES.map((choice, index) => (
            <button
              key={choice.id}
              ref={(node) => { choices.current[index] = node; }}
              type="button"
              className="graphics-choice"
              style={styles.choice}
              data-testid={`graphics-choice-${choice.id}`}
              onKeyDown={(event) => navigate(event, index)}
              onClick={() => onChoose(choice.id)}
              aria-describedby={`graphics-guidance-${choice.id}`}
            >
              <span style={styles.choiceTop}>
                <strong style={styles.choiceTitle}>{choice.label}</strong>
                {choice.recommended ? <span style={styles.badge}>RECOMMENDED</span> : null}
              </span>
              <span id={`graphics-guidance-${choice.id}`} style={styles.guidance}>{choice.guidance}</span>
              <span style={styles.measurements}>
                <span>{choice.downloadGuidance}</span>
                <span>{choice.gpuMemoryGuidance}</span>
              </span>
              <span style={styles.selectLabel}>Use {choice.label} <span aria-hidden="true">→</span></span>
            </button>
          ))}
        </div>
        <p id="graphics-onboarding-method" style={styles.method}>
          Download figures are cold-cache measurements across representative maps. GPU memory is a practical recommendation, not a browser-reported VRAM measurement; results vary by map, browser, display, and operating system.
        </p>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    position: 'fixed', inset: 0, zIndex: 1000, overflow: 'auto', display: 'grid', placeItems: 'center',
    boxSizing: 'border-box', padding: 'clamp(16px, 4vw, 48px)', color: '#edf1f7',
    background: 'radial-gradient(circle at 50% 30%, #222832 0%, #101318 48%, #080a0d 100%)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    width: 'min(960px, 100%)', boxSizing: 'border-box', padding: '34px', borderRadius: 18,
    border: '1px solid rgba(151,164,181,.24)', background: 'rgba(18,22,28,.96)',
    boxShadow: '0 28px 90px rgba(0,0,0,.54)',
  },
  eyebrow: { color: '#f39a58', fontSize: 10, fontWeight: 800, letterSpacing: '.17em' },
  title: { margin: '8px 0 0', fontSize: 'clamp(26px, 4vw, 38px)', lineHeight: 1.1, letterSpacing: '-.035em' },
  intro: { maxWidth: 600, margin: '10px 0 24px', color: '#a9b2c0', fontSize: 14, lineHeight: 1.55 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 },
  choice: {
    minWidth: 0, minHeight: 245, display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left',
    padding: '18px', borderRadius: 12, border: '1px solid rgba(151,164,181,.24)', cursor: 'pointer',
    background: 'rgba(26,30,37,.96)', color: '#edf1f7', font: 'inherit',
  },
  choiceTop: { minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  choiceTitle: { fontSize: 18, letterSpacing: '-.015em' },
  badge: { padding: '4px 6px', borderRadius: 5, color: '#ffc99f', background: 'rgba(240,127,47,.14)', fontSize: 8, fontWeight: 850, letterSpacing: '.1em' },
  guidance: { marginTop: 13, color: '#aab3c1', fontSize: 12, lineHeight: 1.55 },
  measurements: { display: 'grid', gap: 5, marginTop: 16, color: '#7f8a99', fontSize: 10, lineHeight: 1.4 },
  selectLabel: { marginTop: 'auto', paddingTop: 20, color: '#f39a58', fontSize: 12, fontWeight: 750 },
  method: { maxWidth: 760, margin: '18px 0 0', color: '#6f7987', fontSize: 10, lineHeight: 1.55 },
};
