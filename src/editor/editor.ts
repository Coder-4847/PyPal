import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle, bracketMatching, indentOnInput, indentUnit, syntaxHighlighting,
} from '@codemirror/language';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { EditorState, Prec, RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration, EditorView, GutterMarker, drawSelection, gutter, highlightActiveLine, highlightActiveLineGutter,
  keymap, lineNumbers, type DecorationSet,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
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

/* ---------- error line: a marker in the gutter and a tinted line ---------- */
class ErrorDot extends GutterMarker {
  toDOM() {
    const d = document.createElement('span');
    d.className = 'cm-err-dot';
    return d;
  }
}
const dot = new ErrorDot();
const lineDeco = Decoration.line({ class: 'cm-errorLine' });

export const setErrorLine = StateEffect.define<number | null>();

const errorField = StateField.define<{ deco: DecorationSet; markers: RangeSet<GutterMarker> }>({
  create: () => ({ deco: Decoration.none, markers: RangeSet.empty }),
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setErrorLine)) {
        if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return { deco: Decoration.none, markers: RangeSet.empty };
        const from = tr.state.doc.line(e.value).from;
        return { deco: Decoration.set([lineDeco.range(from)]), markers: RangeSet.of([dot.range(from)]) };
      }
    }
    // Editing the file clears the mark: it may no longer be accurate.
    if (tr.docChanged) return { deco: Decoration.none, markers: RangeSet.empty };
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    gutter({ class: 'cm-error-gutter', markers: (view) => view.state.field(f).markers, initialSpacer: () => dot }),
  ],
});

export interface EditorHandle {
  view: EditorView;
  getCode(): string;
  setCode(code: string): void;
  markError(line: number | null): void;
  focus(): void;
}

export interface EditorOptions {
  parent: HTMLElement;
  doc: string;
  onChange(code: string): void;
  onRun(): void;
  onStop(): void;
}

export function createEditor(opts: EditorOptions): EditorHandle {
  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLineGutter(),
    errorField,
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
      ]),
    ),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.onChange(u.state.doc.toString());
    }),
  ];

  const view = new EditorView({ parent: opts.parent, state: EditorState.create({ doc: opts.doc, extensions }) });
  return {
    view,
    getCode: () => view.state.doc.toString(),
    setCode(code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    markError(line) {
      view.dispatch({ effects: setErrorLine.of(line) });
      if (line && line <= view.state.doc.lines) {
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }) });
      }
    },
    focus: () => view.focus(),
  };
}
