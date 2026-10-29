"""Bounded FFmpeg operations; all book chunks use the same PCM format."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid


def executable(name):
    local = Path(sys.executable).parent / (name + ('.exe' if os.name == 'nt' else ''))
    found = str(local) if local.is_file() else shutil.which(name)
    if not found:
        raise RuntimeError(f'Cần cài {name} trong PATH hoặc thư mục venv/Scripts.')
    return found


def run_ffmpeg(args, timeout=300):
    result = subprocess.run([executable('ffmpeg'), '-hide_banner', '-loglevel', 'error', '-y', *args],
                            capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('FFmpeg không xử lý được âm thanh. Kiểm tra định dạng file và dung lượng đĩa.')


def duration(file):
    result = subprocess.run([executable('ffprobe'), '-v', 'error', '-show_entries', 'format=duration',
                             '-of', 'json', str(file)], capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError('Không đo được thời lượng âm thanh.')
    seconds = float(json.loads(result.stdout)['format']['duration'])
    if not 0 < seconds < 14400:
        raise RuntimeError('Thời lượng âm thanh không hợp lệ.')
    return seconds


def normalize(source, destination):
    run_ffmpeg(['-i', str(source), '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(destination)])


def append_silence(source, destination, milliseconds):
    if not isinstance(milliseconds, int) or not 0 <= milliseconds <= 2000:
        raise ValueError('Khoảng nghỉ vượt giới hạn.')
    run_ffmpeg(['-i', str(source), '-af', f'apad=pad_dur={milliseconds / 1000:.3f}',
                '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(destination)])


def preview_clip(source, destination):
    run_ffmpeg(['-i', str(source), '-t', '30', '-ar', '24000', '-ac', '1',
                '-c:a', 'libmp3lame', '-b:a', '128k', str(destination)])


def concatenate(files, destination, mp3=False):
    destination = Path(destination)
    manifest = destination.parent / f'concat_{uuid.uuid4().hex}.txt'
    try:
        # Paths are generated internally, never provided as arbitrary client filenames.
        manifest.write_text('\n'.join("file '" + Path(f).resolve().as_posix().replace("'", "'\\''") + "'" for f in files), encoding='utf-8')
        encoding = ['-c:a', 'libmp3lame', '-b:a', '128k'] if mp3 else ['-c:a', 'pcm_s16le']
        run_ffmpeg(['-f', 'concat', '-safe', '0', '-i', str(manifest), '-ar', '24000', '-ac', '1', *encoding, str(destination)])
    finally:
        manifest.unlink(missing_ok=True)
