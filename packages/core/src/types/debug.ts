/** Normalised amounts and shape of a debug event. Secret values never appear here. */
export interface DebugEvent {
  type: 'request' | 'response' | 'retry' | 'error';
  method: string;
  /** Path only. Query strings are included but never contain credentials. */
  path: string;
  attempt: number;
  status?: number;
  durationMs?: number;
  message?: string;
}
