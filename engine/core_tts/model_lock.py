"""One inference at a time; short previews get the next free model slot."""
import threading
from contextlib import contextmanager


class ModelLock:
    def __init__(self):
        self._condition = threading.Condition()
        self._busy = False
        self._interactive_waiters = 0

    def _acquire(self, interactive=False):
        with self._condition:
            if interactive:
                self._interactive_waiters += 1
            try:
                while self._busy or (not interactive and self._interactive_waiters):
                    self._condition.wait()
                self._busy = True
            finally:
                if interactive:
                    self._interactive_waiters -= 1

    def _release(self):
        with self._condition:
            self._busy = False
            self._condition.notify_all()

    @contextmanager
    def priority(self, interactive=False):
        self._acquire(interactive)
        try:
            yield
        finally:
            self._release()

    def __enter__(self):
        self._acquire()
        return self

    def __exit__(self, *_):
        self._release()
