import { useEffect, useRef } from 'react';
import { Button } from './ui';

const SOURCES = [
  { title: 'Road network', body: 'An OpenStreetMap extract (.osm.pbf) or a GeoJSON file of your streets.' },
  { title: 'Live traffic', body: 'Road speeds from a traffic feed such as TomTom, HERE or your city’s open-data portal.' },
  { title: 'Deliveries', body: 'A CSV of addresses with parcel counts, plus your depot location and van sizes.' },
];

/** Placeholder for bringing in real city data. The upload is intentionally disabled for now. */
export function CityDataDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="city-data-title"
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border-2 border-ink bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b-2 border-ink p-6 sm:p-8">
          <div>
            <p className="inline-block bg-ink px-2 py-0.5 text-sm font-bold text-paper">Coming soon</p>
            <h2 id="city-data-title" className="mt-4 text-[clamp(2rem,4vw,3rem)] leading-none font-black tracking-[-0.03em]">
              Bring your own city.
            </h2>
          </div>
          <Button ref={closeRef} variant="dark" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="space-y-8 p-6 sm:p-8">
          <p className="text-lg leading-relaxed">
            Right now SwarmRoute plans on a simulated city with simulated traffic. The same optimiser will run on real streets once you can load
            these:
          </p>
          <dl className="grid gap-0.5 border-2 border-ink bg-ink sm:grid-cols-3">
            {SOURCES.map((s) => (
              <div key={s.title} className="bg-paper p-5">
                <dt className="font-black">{s.title}</dt>
                <dd className="mt-2 text-sm leading-snug">{s.body}</dd>
              </div>
            ))}
          </dl>
          <div aria-disabled="true" className="border-2 border-dashed border-muted p-8 text-center text-muted">
            <p className="font-bold">File upload isn’t available yet.</p>
            <p className="mt-1 text-sm">Until it is, every plan you see is computed on the simulated city.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
