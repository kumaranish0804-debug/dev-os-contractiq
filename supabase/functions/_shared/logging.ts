// Structured logging for Edge Functions (Spec 03 §3.5, Spec 11).
// One JSON line per event. Contract text, prompts and model output are NEVER logged.

type Level = 'info' | 'warn' | 'error';

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export function log(level: Level, fields: LogFields): void {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
