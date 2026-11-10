"""Send a normalized voice sample and narration part to OmniVoice."""
import json
import os
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import HTTPException
from core_tts.audio_files import normalize, run_ffmpeg


def synthesize(request, sample, destination, secret):
    url = os.environ.get('OMNIVOICE_URL', '').rstrip('/')
    if not url:
        raise HTTPException(503, 'Chưa cấu hình dịch vụ OmniVoice trên Engine.')
    reference = Path(sample).with_name(f'{Path(sample).stem}_omnivoice.wav')
    if not reference.is_file():
        temporary = reference.with_suffix('.tmp.wav')
        try:
            run_ffmpeg(['-i', sample, '-t', '8', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', str(temporary)])
            temporary.replace(reference)
        finally:
            temporary.unlink(missing_ok=True)

    payload = {'job_id': request.job_id, 'part_id': request.part_id, 'text': request.text,
               'reference_name': reference.name, 'model_revision': request.model_revision,
               'rate_percent': request.rate_percent or 0}
    upstream = Request(url + '/synthesize', data=json.dumps(payload).encode(),
                       headers={'Content-Type': 'application/json', 'X-Book-Engine-Secret': secret})
    generated = Path(destination).parent / f'{request.part_id}.omnivoice.wav'
    try:
        with urlopen(upstream, timeout=1100) as response:
            result = json.load(response)
        if result.get('model_revision') != request.model_revision or not generated.is_file():
            raise RuntimeError('OmniVoice trả kết quả không hợp lệ.')
        normalize(generated, destination)
    except HTTPError as error:
        messages = {400: 'Giọng mẫu OmniVoice không hợp lệ.',
                    403: 'Khóa nội bộ OmniVoice không khớp.',
                    409: 'Phiên bản OmniVoice trên Engine không khớp yêu cầu.'}
        raise HTTPException(503, detail={
            'code': 'OMNIVOICE_SERVICE_ERROR',
            'message': messages.get(error.code, 'OmniVoice chưa tạo được âm thanh. Kiểm tra log dịch vụ.'),
            'retryable': error.code == 429 or error.code >= 500,
        }) from None
    except (URLError, TimeoutError):
        raise HTTPException(503, detail={
            'code': 'OMNIVOICE_CONNECTION_FAILED',
            'message': 'Dịch vụ OmniVoice chưa phản hồi. Hãy kiểm tra container và thử lại.',
            'retryable': True,
        }) from None
    finally:
        generated.unlink(missing_ok=True)
