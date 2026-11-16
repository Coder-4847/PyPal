import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo } from '@codemirror/commands';
import {
  HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting,
} from '@codemirror/language';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { EditorState, Prec, RangeSet, type Range, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, GutterMarker, drawSelection, gutter, highlightActiveLine, highlightActiveLineGutter,
  hoverTooltip, keymap, lineNumbers, type DecorationSet,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { motionScale } from '../motion/motion';
import { pythonWords } from './completions';

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.comment, t.lineComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: 'var(--syn-func)' },
  { tag: [t.standard(t.variableName), t.className], color: 'var(--syn-builtin)' },
  { tag: [t.self], color: 'var(--syn-self)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--syn-op)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

/* ---------------- problems: squiggle, gutter dot, hover message ---------------- */

export interface DiagMark {
  from: number;
  to: number;
  title: string;
  what: string;
  hint: string;
}
export type DiagSource = 'syntax' | 'run';

/** `fresh` marks a problem the student has not seen yet: its squiggle draws in and its dot pulses once. */
export const setDiagnostics = StateEffect.define<{ source: DiagSource; marks: DiagMark[]; fresh: boolean }>();

class ErrorDot extends GutterMarker {
  constructor(readonly pulse: boolean, readonly kind: DiagSource) {
    super();
  }
  eq(other: GutterMarker) {
    return other instanceof ErrorDot && other.pulse === this.pulse && other.kind === this.kind;
  }
  toDOM() {
    const d = document.createElement('span');
    d.className = `cm-err-dot${this.pulse ? ' cm-err-pulse' : ''}`;
    return d;
  }
}

interface DiagState {
  syntax: DiagMark[];
  run: DiagMark[];
  fresh: boolean;
  deco: DecorationSet;
  markers: RangeSet<GutterMarker>;
  all: DiagMark[];
}

function build(state: EditorState, syntax: DiagMark[], run: DiagMark[], fresh: boolean): DiagState {
  const len = state.doc.length;
  const decos: Range<Decoration>[] = [];
  const dots: { from: number; m: GutterMarker }[] = [];
  const seenLines = new Set<number>();
  const clamp = (m: DiagMark) => {
    const from = Math.max(0, Math.min(m.from, len));
    const to = Math.max(from, Math.min(m.to, len));
    return { ...m, from, to };
  };
  const mark = (raw: DiagMark, source: DiagSource) => {
    const m = clamp(raw);
    if (m.to > m.from) {
      decos.push(Decoration.mark({ class: `cm-squiggle${fresh ? ' cm-squiggle-new' : ''}` }).range(m.from, m.to));
    }
    const line = state.doc.lineAt(m.from);
    if (source === 'run') decos.push(Decoration.line({ class: 'cm-errorLine' }).range(line.from));
    if (!seenLines.has(line.number)) {
      seenLines.add(line.number);
      dots.push({ from: line.from, m: new ErrorDot(fresh, source) });
    }
  };
  syntax.forEach((m) => mark(m, 'syntax'));
  run.forEach((m) => mark(m, 'run'));
  return {
    syntax, run, fresh,
    deco: Decoration.set(decos, true),
    markers: RangeSet.of(dots.sort((a, b) => a.from - b.from).map((d) => d.m.range(d.from)), true),
    all: [...syntax, ...run].map(clamp),
  };
}

const diagField = StateField.define<DiagState>({
  create: (state) => build(state, [], [], false),
  update(v, tr) {
    let { syntax, run } = v;
    let fresh = false;
    let touched = false;
    for (const e of tr.effects) {
      if (!e.is(setDiagnostics)) continue;
      touched = true;
      if (e.value.source === 'syntax') syntax = e.value.marks;
      else run = e.value.marks;
      fresh ||= e.value.fresh;
    }
    if (tr.docChanged) {
      // Editing clears a run error (it may no longer apply) and keeps squiggles in place until the next check.
      run = [];
      if (!tr.effects.some((e) => e.is(setDiagnostics) && e.value.source === 'syntax')) {
        syntax = syntax.map((m) => ({ ...m, from: tr.changes.mapPos(m.from, 1), to: tr.changes.mapPos(m.to, -1) }));
      }
      touched = true;
    }
    return touched ? build(tr.state, syntax, run, fresh) : v;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    gutter({
      class: 'cm-error-gutter',
      markers: (view) => view.state.field(f).markers,
      initialSpacer: () => new ErrorDot(false, 'syntax'),
    }),
  ],
});

const diagTooltip = hoverTooltip(
  (view, pos) => {
    const hit = view.state.field(diagField).all.find((m) => pos >= m.from && pos <= m.to);
    if (!hit) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create() {
        const dom = document.createElement('div');
        dom.className = 'cm-diag-tip';
        const title = document.createElement('strong');
        title.textContent = hit.title;
        const what = document.createElement('p');
        what.textContent = hit.what;
        const hint = document.createElement('p');
        hint.className = 'cm-diag-hint';
        hint.textContent = hit.hint;
        dom.append(title, what, hint);
        return { dom };
      },
    };
  },
  { hoverTime: 250 },
);

/* ---------------- fix preview: shimmer on lines about to change, green wipe on accept ---------------- */

export const setShimmer = StateEffect.define<number[]>(); // 1-based line numbers
export const addWipe = StateEffect.define<{ from: number; to: number }[]>(); // 1-based, inclusive ranges
const clearWipe = StateEffect.define<null>();

const shimmerLine = Decoration.line({ class: 'cm-fix-shimmer' });
const wipeLine = Decoration.line({ class: 'cm-fix-wipe' });

function lineDecos(state: EditorState, lines: number[], deco: Decoration): DecorationSet {
  const ranges = [...new Set(lines)].filter((n) => n >= 1 && n <= state.doc.lines).sort((a, b) => a - b).map((n) => deco.range(state.doc.line(n).from));
  return Decoration.set(ranges);
}

const fixField = StateField.define<{ shimmer: DecorationSet; wipe: DecorationSet }>({
  create: () => ({ shimmer: Decoration.none, wipe: Decoration.none }),
  update(v, tr) {
    let { shimmer, wipe } = v;
    if (tr.docChanged) {
      shimmer = shimmer.map(tr.changes);
      wipe = wipe.map(tr.changes);
    }
    for (const e of tr.effects) {
      if (e.is(setShimmer)) shimmer = lineDecos(tr.state, e.value, shimmerLine);
      else if (e.is(addWipe)) {
        const lines: number[] = [];
        for (const r of e.value) for (let n = r.from; n <= r.to; n++) lines.push(n);
        wipe = lineDecos(tr.state, lines, wipeLine);
      } else if (e.is(clearWipe)) wipe = Decoration.none;
    }
    return { shimmer, wipe };
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.shimmer), EditorView.decorations.from(f, (v) => v.wipe)],
});

/* ---------------- the editor ---------------- */

export interface EditorHandle {
  view: EditorView;
  getCode(): string;
  setCode(code: string): void;
  setDiagnostics(source: DiagSource, marks: DiagMark[], fresh: boolean): void;
  /** Convert 1-based line / column (as Python reports them) to a document offset. */
  offsetAt(line: number, col1: number): number;
  lineEnd(line: number): number;
  jumpToLine(line: number): void;
  showShimmer(lines: number[]): void;
  /** Apply several edits as ONE undoable change. */
  applyEdits(edits: { from: number; to: number; insert: string }[]): void;
  wipe(ranges: { from: number; to: number }[]): void;
  undo(): boolean;
  selectedLines(): { from: number; to: number } | null;
  focus(): void;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange(code: string): void;
  onRun(): void;
  onStop(): void;
  onFix?(): void;
  extensions?: Extension[];
}

export function createEditor(opts: EditorOptions): EditorHandle {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    diagField,
    diagTooltip,
    fixField,
    history(),
    drawSelection(),
    indentUnit.of('    '),
    EditorState.tabSize.of(4),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    python(),
    pythonLanguage.data.of({ autocomplete: pythonWords }),
    autocompletion({ icons: false, maxRenderedOptions: 12 }),
    syntaxHighlighting(highlight),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': 'Python code editor', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    Prec.highest(
      keymap.of([
        { key: 'Mod-Enter', run: () => (opts.onRun(), true) },
        { key: 'Mod-.', run: () => (opts.onStop(), true) },
        { key: 'Mod-Shift-Enter', run: () => (opts.onFix?.(), true) },
      ]),
    ),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
    ...(opts.extensions ?? []),
  ];

  const view = new EditorView({ parent: opts.parent, state: EditorState.create({ doc: opts.doc, extensions }) });
  let wipeTimer = 0;
  const lines = () => view.state.doc.lines;
  const clampLine = (n: number) => Math.max(1, Math.min(n, lines()));

  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    setDiagnostics(source, marks, fresh) {
      view.dispatch({ effects: setDiagnostics.of({ source, marks, fresh }) });
    },
    offsetAt(line, col1) {
      const l = view.state.doc.line(clampLine(line));
      return Math.min(l.to, l.from + Math.max(0, col1 - 1));
    },
    lineEnd: (line) => view.state.doc.line(clampLine(line)).to,
    jumpToLine(line) {
      const l = view.state.doc.line(clampLine(line));
      view.dispatch({
        selection: { anchor: l.from, head: l.to },
        effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
      });
      view.focus();
    },
    showShimmer(ls) {
      view.dispatch({ effects: setShimmer.of(ls) });
    },
    applyEdits(edits) {
      view.dispatch({ changes: edits, annotations: Transaction.userEvent.of('input.fix'), effects: setShimmer.of([]) });
    },
    wipe(ranges) {
      window.clearTimeout(wipeTimer);
      view.dispatch({ effects: addWipe.of(ranges) });
      wipeTimer = window.setTimeout(() => view.dispatch({ effects: clearWipe.of(null) }), 900 * motionScale());
    },
    undo: () => undo(view),
    selectedLines() {
      const sel = view.state.selection.main;
      if (sel.empty) return null;
      const a = view.state.doc.lineAt(sel.from).number;
      // a selection that ends at the very start of a line does not include that line
      const endPos = sel.to > sel.from && view.state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.to;
      return { from: a, to: Math.max(a, view.state.doc.lineAt(endPos).number) };
    },
    focus: () => view.focus(),
  };
}
