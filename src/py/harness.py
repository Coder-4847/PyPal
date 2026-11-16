import builtins
import json
import sys

import pypal_bridge

_FILENAME = "main.py"
# describe_exception() comes from diagnose.py, which is loaded first.


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
        result.update(ok=False, error=describe_exception(exc, None))
    except BaseException as exc:  # noqa: BLE001 - the student's code may raise anything
        tb = exc.__traceback__
        tb = tb.tb_next if tb is not None else None  # drop this harness frame
        result.update(ok=False, error=describe_exception(exc, tb))
    finally:
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:  # noqa: BLE001
            pass
    return json.dumps(result)
