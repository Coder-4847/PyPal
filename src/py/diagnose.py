"""Diagnostics shared by the browser workers and the Vitest fixture runner.

Everything here is plain Python with no PyPal-specific imports, so the same
file runs in Pyodide in the browser and in Node during tests.
"""
import ast
import builtins
import contextlib
import json
import re
import sys
import traceback
import warnings

_FILE = "main.py"
_SUGGESTION = re.compile(r"Did you mean: '([^']+)'\?")


def describe_exception(exc, tb_start=None, filename=_FILE):
    """Turn an exception into a plain dict (the RunError shape the page expects)."""
    lineno = offset = end_lineno = end_offset = text = None
    if isinstance(exc, SyntaxError):
        lineno, offset = exc.lineno, exc.offset
        end_lineno, end_offset = getattr(exc, "end_lineno", None), getattr(exc, "end_offset", None)
        text = exc.text
        message = exc.msg
    else:
        message = str(exc)
        tb = tb_start
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == filename:
                lineno = tb.tb_lineno
            tb = tb.tb_next
    raw = "".join(traceback.format_exception(type(exc), exc, tb_start))
    found = _SUGGESTION.search(raw)
    return {
        "kind": "syntax" if isinstance(exc, SyntaxError) else "runtime",
        "type": type(exc).__name__,
        "message": message,
        "lineno": lineno,
        "offset": offset,
        "endLineno": end_lineno,
        "endOffset": end_offset,
        "text": text,
        "traceback": raw,
        "suggestion": found.group(1) if found else None,
    }


def syntax_diagnostic(source):
    """Check the source with ast.parse and compile. Returns a dict, or None if it is valid."""
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            ast.parse(source, _FILE)
            compile(source, _FILE, "exec", dont_inherit=True)
    except SyntaxError as exc:
        return describe_exception(exc)
    except (ValueError, RecursionError, MemoryError) as exc:  # null bytes, absurd nesting
        return {
            "kind": "syntax", "type": "SyntaxError", "message": str(exc) or type(exc).__name__,
            "lineno": 1, "offset": 1, "endLineno": None, "endOffset": None, "text": None,
            "traceback": f"SyntaxError: {exc}\n", "suggestion": None,
        }
    return None


class _StepLimit(BaseException):
    pass


class _Discard:
    def write(self, s):
        return len(s)

    def flush(self):
        pass

    def isatty(self):
        return False


def _stub_input(prompt=""):
    return "1"


def sandbox_diagnostic(source, max_steps=400000):
    """Syntax check, then run the program with a stubbed input() and a step limit.

    Returns a diagnostic dict, or None if the program compiled and ran without raising
    (or ran out of steps, which is inconclusive, not an error)."""
    syntax = syntax_diagnostic(source)
    if syntax:
        return syntax
    import time

    code = compile(source, _FILE, "exec", dont_inherit=True)
    namespace = {"__name__": "__main__", "__file__": _FILE, "__builtins__": builtins}
    steps = 0

    def tracer(frame, event, arg):
        nonlocal steps
        if frame.f_code.co_filename != _FILE:
            return None
        if event == "line":
            steps += 1
            if steps > max_steps:
                raise _StepLimit()
        return tracer

    saved_input, saved_sleep = builtins.input, time.sleep
    builtins.input = _stub_input
    time.sleep = lambda s: None
    result = None
    sink = _Discard()
    try:
        with warnings.catch_warnings(), contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            warnings.simplefilter("ignore")
            sys.settrace(tracer)
            try:
                exec(code, namespace)
            finally:
                sys.settrace(None)
    except (_StepLimit, SystemExit, KeyboardInterrupt):
        result = None
    except BaseException as exc:  # noqa: BLE001 - the student's code may raise anything
        tb = exc.__traceback__
        tb = tb.tb_next if tb is not None else None
        result = describe_exception(exc, tb)
    finally:
        builtins.input, time.sleep = saved_input, saved_sleep
    return result


def analyze(source, run=False):
    d = sandbox_diagnostic(source) if run else syntax_diagnostic(source)
    return json.dumps(d)


def scope_names(source):
    """Names the program binds (variables, functions, classes, imports, parameters)."""
    bound = set()
    try:
        tree = ast.parse(source)
    except Exception:  # noqa: BLE001
        tree = None
    if tree is not None:
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, (ast.Store, ast.Del)):
                bound.add(node.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                bound.add(node.name)
            elif isinstance(node, ast.arg):
                bound.add(node.arg)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    bound.add(a.asname or a.name.split(".")[0])
            elif isinstance(node, ast.ExceptHandler) and node.name:
                bound.add(node.name)
            elif isinstance(node, (ast.Global, ast.Nonlocal)):
                bound.update(node.names)
    return json.dumps({"bound": sorted(bound), "builtins": [n for n in dir(builtins) if not n.startswith("_")]})
