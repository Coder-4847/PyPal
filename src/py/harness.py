import builtins
import json
import sys
import traceback

import pypal_bridge

_FILENAME = "main.py"


def _input(prompt=""):
    answer = pypal_bridge.read_input(str(prompt))
    if answer is None:
        raise KeyboardInterrupt
    return answer


def _sleep(seconds):
    seconds = float(seconds)
    if seconds < 0:
        raise ValueError("sleep length must be non-negative")
    if pypal_bridge.sleep(seconds):
        raise KeyboardInterrupt


def _install():
    import time

    builtins.input = _input
    time.sleep = _sleep


_install()


def _describe(exc, tb_start):
    lineno = None
    offset = None
    end_lineno = None
    end_offset = None
    text = None
    if isinstance(exc, SyntaxError):
        lineno, offset = exc.lineno, exc.offset
        end_lineno, end_offset = getattr(exc, "end_lineno", None), getattr(exc, "end_offset", None)
        text = exc.text
        message = exc.msg
    else:
        message = str(exc)
        tb = tb_start
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == _FILENAME:
                lineno = tb.tb_lineno
            tb = tb.tb_next
    return {
        "type": type(exc).__name__,
        "message": message,
        "lineno": lineno,
        "offset": offset,
        "endLineno": end_lineno,
        "endOffset": end_offset,
        "text": text,
        "traceback": "".join(traceback.format_exception(type(exc), exc, tb_start)),
    }


def run_user_code(source):
    """Run the student's program. Returns a JSON string: {"ok", "stopped", "error"}."""
    result = {"ok": True, "stopped": False, "error": None}
    namespace = {"__name__": "__main__", "__file__": _FILENAME, "__builtins__": builtins}
    try:
        code = compile(source, _FILENAME, "exec")
        exec(code, namespace)
    except SystemExit:
        pass
    except KeyboardInterrupt:
        result.update(ok=False, stopped=True)
    except SyntaxError as exc:
        result.update(ok=False, error=_describe(exc, None))
    except BaseException as exc:  # noqa: BLE001 - the student's code may raise anything
        tb = exc.__traceback__
        tb = tb.tb_next if tb is not None else None  # drop this harness frame
        result.update(ok=False, error=_describe(exc, tb))
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:  # noqa: BLE001
            pass
    return json.dumps(result)
