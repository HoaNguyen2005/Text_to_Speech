"""Install and sample OmniVoice on Windows CPU or NVIDIA CUDA."""

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time


def select_device(requested, nvidia_available):
    if requested == "auto":
        return "cuda" if nvidia_available else "cpu"
    if requested == "cuda" and not nvidia_available:
        raise ValueError("CUDA requested, but NVIDIA driver is not available.")
    return requested


def generate(device, output):
    import numpy as np
    import soundfile as sf
    import torch
    from omnivoice import OmniVoice

    if device == "cuda" and not torch.cuda.is_available():
        sys.exit("CUDA is unavailable in PyTorch. Check the NVIDIA driver or use --device cpu.")
    print(f"Device: {torch.cuda.get_device_name(0) if device == 'cuda' else 'CPU'}", flush=True)
    started = time.perf_counter()
    model = OmniVoice.from_pretrained(
        "k2-fsa/OmniVoice",
        device_map=device,
        dtype=torch.float16 if device == "cuda" else torch.float32,
    )
    loaded = time.perf_counter()
    sample = "Buổi chiều ở Cần Thơ, mưa vừa tạnh. Bạn có nghe tiếng nước nhỏ xuống bên hiên không?"
    audio = model.generate(text=sample, language="vi")[0]
    assert np.isfinite(audio).all() and len(audio) > model.sampling_rate and np.abs(audio).max() > 0.001, "Empty or invalid recording"
    with tempfile.TemporaryDirectory(dir=output.parent) as temp:
        wav = Path(temp) / "sample.wav"
        sf.write(wav, audio, model.sampling_rate)
        info = sf.info(wav)
        assert info.duration > 1 and info.frames == len(audio), "Invalid WAV output"
        wav.replace(output)
    print(f"Load: {loaded - started:.1f}s; synthesis: {time.perf_counter() - loaded:.1f}s; audio: {info.duration:.1f}s")
    print(f"Audio: {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    parser.add_argument("--generate-only", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if os.name != "nt" or sys.maxsize <= 2**32 or not (3, 10) <= sys.version_info[:2] <= (3, 12):
        sys.exit("Run this trial with 64-bit Python 3.10–3.12 on Windows.")
    nvidia = shutil.which("nvidia-smi")
    available = bool(nvidia) and subprocess.run(
        [nvidia, "--query-gpu=name", "--format=csv,noheader"], capture_output=True
    ).returncode == 0
    try:
        device = select_device(args.device, available)
    except ValueError as error:
        sys.exit(str(error))
    trial = Path.home() / "OmniVoice-trial"
    trial.mkdir(exist_ok=True)
    output = trial / f"omnivoice-vi-{device}.wav"
    if args.generate_only:
        generate(device, output)
        return
    env = trial / f"venv-{sys.version_info.major}.{sys.version_info.minor}-{device}"
    python = env / "Scripts" / "python.exe"
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", env], check=True)

    def run(*args):
        subprocess.run([python, "-X", "utf8", *args], check=True)

    build = "cu128" if device == "cuda" else "cpu"
    torch = f"torch==2.8.0+{build}"
    torchaudio = f"torchaudio==2.8.0+{build}"
    run("-m", "pip", "install", "--upgrade", "pip")
    run("-m", "pip", "install", torch, torchaudio,
        "--index-url", f"https://download.pytorch.org/whl/{build}")
    run("-m", "pip", "install", "omnivoice==0.2.1", torch, torchaudio)
    run("-m", "pip", "check")
    run(Path(__file__).resolve(), "--device", device, "--generate-only")


if __name__ == "__main__":
    main()
