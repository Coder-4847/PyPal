/** Messages between the page and the Python worker. */

export interface RunError {
  type: string; // e.g. "NameError"
  message: string;
  lineno: number | null;
  offset: number | null;
  endLineno: number | null;
  endOffset: number | null;
  text: string | null;
  traceback: string; // raw traceback, shown behind "Show details"
}

export interface InitMessage {
  type: 'init';
  base: string;
  interruptBuffer: SharedArrayBuffer | null;
  inputBuffer: SharedArrayBuffer | null;
}
export interface RunMessage {
  type: 'run';
  id: number;
  code: string;
}
export type ToWorker = InitMessage | RunMessage;

export type FromWorker =
  | { type: 'progress'; value: number; label: string }
  | { type: 'ready'; version: string }
  | { type: 'boot-error'; message: string }
  | { type: 'out'; stream: 'out' | 'err'; text: string; dropped?: boolean }
  | { type: 'input-request'; prompt: string }
  | { type: 'packages'; state: 'start' | 'progress' | 'end'; label: string }
  | { type: 'done'; id: number; ok: boolean; stopped: boolean; error: RunError | null };

/** Layout of the shared buffer used for input(): [state, length, ...bytes] */
export const INPUT_HEADER_BYTES = 8;
export const INPUT_BUFFER_BYTES = 64 * 1024;
export const INPUT_IDLE = 0;
export const INPUT_READY = 1;
export const INPUT_CANCEL = 2;
export const SIGINT = 2;
