/** Messages between the page and the Python worker. */

import type { Diag } from '../fix/types';

/** A problem Python reported (syntax or runtime). The raw traceback stays behind "Show details". */
export type RunError = Diag;

export interface InitMessage {
  type: 'init';
  /** 'main' runs the student's programs; 'sandbox' only checks and test-runs code for the fix engine. */
  mode: 'main' | 'sandbox';
  base: string;
  interruptBuffer: SharedArrayBuffer | null;
  inputBuffer: SharedArrayBuffer | null;
}
export interface RunMessage {
  type: 'run';
  id: number;
  code: string;
}
export interface AnalyzeMessage {
  type: 'analyze';
  id: number;
  code: string;
  run: boolean; // also run it (sandbox only) with stubbed input()
}
export interface ScopeMessage {
  type: 'scope';
  id: number;
  code: string;
}
export type ToWorker = InitMessage | RunMessage | AnalyzeMessage | ScopeMessage;

export type FromWorker =
  | { type: 'progress'; value: number; label: string }
  | { type: 'ready'; version: string }
  | { type: 'boot-error'; message: string }
  | { type: 'out'; stream: 'out' | 'err'; text: string; dropped?: boolean }
  | { type: 'input-request'; prompt: string }
  | { type: 'packages'; state: 'start' | 'progress' | 'end'; label: string }
  | { type: 'done'; id: number; ok: boolean; stopped: boolean; error: RunError | null }
  | { type: 'analyze-result'; id: number; diag: Diag | null }
  | { type: 'scope-result'; id: number; bound: string[]; builtins: string[] };

/** Layout of the shared buffer used for input(): [state, length, ...bytes] */
export const INPUT_HEADER_BYTES = 8;
export const INPUT_BUFFER_BYTES = 64 * 1024;
export const INPUT_IDLE = 0;
export const INPUT_READY = 1;
export const INPUT_CANCEL = 2;
export const SIGINT = 2;
