/**
 * One text field of a settings form: local edits show immediately, save 600 ms after typing
 * stops (and immediately on blur), and a thrown error surfaces inline without losing what the
 * user typed. Matches the app's "autosave everything, confirm almost nothing" rule (UX_FLOWS §1)
 * for the agency and report-info screens, which have no Save button.
 */
import { useEffect, useRef, useState } from 'react';

export interface AutosaveField {
  value: string;
  setValue: (v: string) => void;
  /** Call from TextField's onBlur to flush immediately instead of waiting for the debounce. */
  onBlur: () => void;
  saving: boolean;
  /** Message from the last failed save (e.g. a validation error); cleared on the next attempt. */
  error: string | null;
}

export function useAutosaveField(
  initial: string,
  commit: (value: string) => Promise<unknown>,
  delay = 600,
): AutosaveField {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef(initial);
  const dirtyRef = useRef(false);
  const initialRef = useRef(initial);
  const commitRef = useRef(commit);

  // Refs are updated after render (not during it), per the "keep latest callback" pattern.
  useEffect(() => {
    commitRef.current = commit;
  });

  // The loaded value changed under us (first load finishing, or written elsewhere): adopt it,
  // unless the user already has an unsaved edit in flight.
  useEffect(() => {
    if (initial === initialRef.current) return;
    initialRef.current = initial;
    if (!dirtyRef.current) {
      savedRef.current = initial;
      setValue(initial);
    }
  }, [initial]);

  const flush = (next: string) => {
    if (next === savedRef.current) return;
    setSaving(true);
    setError(null);
    commitRef
      .current(next)
      .then(() => {
        savedRef.current = next;
        dirtyRef.current = false;
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setSaving(false));
  };

  useEffect(() => {
    if (value === savedRef.current) return;
    dirtyRef.current = true;
    const t = setTimeout(() => flush(value), delay);
    return () => clearTimeout(t);
    // flush reads through refs, so it doesn't need to be a dependency; re-running per keystroke
    // (and cancelling the previous timer) is the whole point of the effect.
  }, [value, delay]);

  return { value, setValue, onBlur: () => flush(value), saving, error };
}
