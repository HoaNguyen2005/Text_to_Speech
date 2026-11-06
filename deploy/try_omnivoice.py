"""Run on the Windows RTX desktop with Python 3.10–3.12."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    if os.name != "nt" or not (3, 10) <= sys.version_info[:2] <= (3, 12):
        sys.exit("Run this trial with 64-bit Python 3.10–3.12 on Windows.")
    if not shutil.which("nvidia-smi"):
        sys.exit("NVIDIA driver not detected. Check nvidia-smi on the RTX desktop.")
    devices = subprocess.check_output(
        ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], text=True
    )
    if "4060" not in devices:
        sys.exit(f"Expected an RTX 4060. Detected: {devices.strip()}")

    trial = Path.home() / "OmniVoice-trial"
    trial.mkdir(exist_ok=True)
    env = trial / f"venv-{sys.version_info.major}.{sys.version_info.minor}"
    python = env / "Scripts" / "python.exe"
    if not python.is_file():
        subprocess.run([sys.executable, "-m", "venv", env], check=True)

    def run(*args):
        subprocess.run([python, "-X", "utf8", *args], check=True)

    run("-m", "pip", "install", "torch==2.8.0", "torchaudio==2.8.0",
        "--index-url", "https://download.pytorch.org/whl/cu128")
    run("-m", "pip", "install", "omnivoice", "torch==2.8.0", "torchaudio==2.8.0")
    gpu = subprocess.check_output([
        python, "-c", "import torch; print(next((i for i in range(torch.cuda.device_count()) "
        "if '4060' in torch.cuda.get_device_name(i)), -1))"
    ], text=True).strip()
    if gpu == "-1":
        sys.exit("PyTorch cannot access the RTX 4060. Check the NVIDIA driver.")

    sample = "Buổi chiều ở Cần Thơ, mưa vừa tạnh. Bạn có nghe tiếng nước nhỏ xuống bên hiên không?"
    with tempfile.TemporaryDirectory(dir=trial) as temp:
        wav = Path(temp) / "sample.wav"
        run("-m", "omnivoice.cli.infer", "--device", f"cuda:{gpu}", "--language", "vi",
            "--text", sample, "--output", wav)
        run("-c", "import soundfile as sf, sys; x, sr = sf.read(sys.argv[1]); "
            "assert len(x) > sr and abs(x).max() > 0.001, 'Empty or silent recording'; "
            "print(f'{len(x) / sr:.1f} seconds, {sr} Hz')", wav)
        output = trial / "omnivoice-vi.wav"
        wav.replace(output)
    print(f"GPU: RTX 4060 (cuda:{gpu})\nAudio: {output}")


if __name__ == "__main__":
    main()
