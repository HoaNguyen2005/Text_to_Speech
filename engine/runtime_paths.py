"""Shared filesystem locations; defaults preserve the Windows development layout."""
import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent / 'backend'
AUDIO_ROOT = Path(os.getenv('AUDIO_ROOT') or BACKEND_ROOT / 'public' / 'audio').resolve()
SAMPLES = AUDIO_ROOT / 'samples'
GENERATED = AUDIO_ROOT / 'generated'
BOOK_ARTIFACT_ROOT = Path(os.getenv('BOOK_ARTIFACT_ROOT') or BACKEND_ROOT / 'data' / 'book-audio').resolve()
