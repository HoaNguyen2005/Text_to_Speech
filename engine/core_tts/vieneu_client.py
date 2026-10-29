"""Adapter for the private VieNeu service; no shared Python model dependencies."""
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from fastapi import HTTPException
from core_tts.audio_files import run_ffmpeg

MODEL_REVISION = 'vieneu-3.8.3-v3turbo-61b85e3d937fbbacb387714180e8182823512523'


def synthesize(request, sample, destination, secret):
    if request.model_revision != MODEL_REVISION:
        raise ValueError('Phiên bản VieNeu không khớp yêu cầu.')
    payload = {'job_id': request.job_id, 'part_id': request.part_id, 'text': request.text,
               'preset': request.preset, 'model_revision': MODEL_REVISION,
               'experimental_cues': request.experimental_cues}
    clip = None
    generated = Path(destination).parent / f'{request.part_id}.vieneu.wav'
    try:
        if sample:
            # Reuse one short, normalized reference per job for SDK embedding caching.
            clip = Path(sample).with_name(Path(sample).stem + '_vieneu.wav')
            if not clip.is_file():
                run_ffmpeg(['-i', str(sample), '-t', '8', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(clip)])
            payload['reference_path'] = str(clip)
        url = os.getenv('VIENEU_URL', 'http://127.0.0.1:8001').rstrip('/')
        upstream = Request(url + '/synthesize', data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json', 'X-Book-Engine-Secret': secret})
        try:
            with urlopen(upstream, timeout=1100) as response:
                result = json.load(response)
        except HTTPError as error:
            messages = {
                400: 'Giọng mẫu hoặc nội dung gửi sang VieNeu không hợp lệ. Kiểm tra mẫu âm thanh rồi thử lại.',
                403: 'Khóa nội bộ VieNeu không khớp. Kiểm tra cấu hình Engine và VieNeu.',
                409: 'Phiên bản VieNeu không khớp yêu cầu. Kiểm tra cấu hình model.',
            }
            print(f'[VIENEU CLIENT ERROR] http_status={error.code}')
            raise HTTPException(503, detail={'code': 'VIENEU_SERVICE_ERROR',
                'message': messages.get(error.code, 'VieNeu chưa tạo được âm thanh. Kiểm tra giọng mẫu hoặc log dịch vụ VieNeu.'),
                'retryable': error.code == 429 or error.code >= 500}) from None
        except (URLError, TimeoutError):
            raise HTTPException(503, detail={'code': 'VIENEU_CONNECTION_FAILED', 'message': 'Không kết nối được dịch vụ VieNeu hoặc xử lý quá thời gian chờ. Hãy thử lại.', 'retryable': True}) from None
        if Path(result['output_path']).resolve() != generated.resolve() or result.get('model_revision') != MODEL_REVISION:
            raise RuntimeError('Đường dẫn hoặc phiên bản VieNeu không hợp lệ.')
        rate = request.rate_percent or 0
        run_ffmpeg(['-i', str(generated), '-af', f'atempo={1 + rate / 100:.4f}',
                    '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(destination)])
    finally:
        generated.unlink(missing_ok=True)
