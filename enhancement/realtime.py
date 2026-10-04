"""Bounded single-frame neural inference; no frame is persisted to disk."""
import hashlib
import threading
import time

_MODEL = None
_LOCK = threading.Lock()


def jpeg_dimensions(data):
    if not data.startswith(b'\xff\xd8'):
        raise ValueError('Realtime input must be JPEG')
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 255:
            raise ValueError('Invalid JPEG header')
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data): break
        marker = data[offset]; offset += 1
        if marker in (0xd8, 0xd9): continue
        length = int.from_bytes(data[offset:offset+2], 'big')
        if length < 2 or offset + length > len(data): break
        if marker in (0xc0, 0xc1, 0xc2):
            if length < 8: break
            height = int.from_bytes(data[offset+3:offset+5], 'big')
            width = int.from_bytes(data[offset+5:offset+7], 'big')
            if min(width, height) < 2 or max(width, height) > 960 or min(width, height) > 540:
                raise ValueError('Realtime frame supports up to 960x540 (portrait allowed)')
            return width, height
        if marker == 0xda: break
        offset += length
    raise ValueError('Invalid JPEG dimensions')


def frame_dimensions(data):
    if data.startswith(b'\x89PNG\r\n\x1a\n') and len(data)>=33 and data[12:16]==b'IHDR':
        width=int.from_bytes(data[16:20],'big');height=int.from_bytes(data[20:24],'big')
        if min(width,height)<2 or max(width,height)>960 or min(width,height)>540:
            raise ValueError('Realtime frame supports up to 960x540 (portrait allowed)')
        return width,height
    return jpeg_dimensions(data)


def enhance_frame(data, model_path, model_hash, lossless=False):
    global _MODEL
    width, height = frame_dimensions(data)
    import cv2
    import numpy as np
    started = time.perf_counter()
    with _LOCK:
        if _MODEL is None:
            if hashlib.sha256(model_path.read_bytes()).hexdigest() != model_hash:
                raise RuntimeError('AI model checksum mismatch')
            cv2.setNumThreads(4)
            model = cv2.dnn_superres.DnnSuperResImpl_create()
            model.readModel(str(model_path)); model.setModel('fsrcnn', 2)
            _MODEL = model
        frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if frame is None or frame.shape[:2] != (height, width):
            raise ValueError('Invalid JPEG frame')
        # Mild spatial denoise before actual neural super-resolution.
        cleaned = cv2.bilateralFilter(frame, 3, 12, 12)
        enhanced = _MODEL.upsample(cleaned)
        ok, encoded = cv2.imencode('.png' if lossless else '.jpg', enhanced, [cv2.IMWRITE_PNG_COMPRESSION, 1] if lossless else [cv2.IMWRITE_JPEG_QUALITY, 94])
        if not ok: raise RuntimeError('Could not encode enhanced frame')
    return encoded.tobytes(), (time.perf_counter()-started)*1000


def enhance_rgb(data, width, height, model_path, model_hash, protect_text=True):
    """Same-size RGB fallback. Never claims to be a temporal/generative model."""
    global _MODEL
    if not (2 <= width <= 1080 and 2 <= height <= 1080) or len(data) != width*height*3:
        raise ValueError('RGB frame dimensions or length are invalid (long edge up to 1080)')
    import cv2
    import numpy as np
    started=time.perf_counter()
    with _LOCK:
        frame=np.frombuffer(data,np.uint8).reshape(height,width,3)
        if _MODEL is None:
            if hashlib.sha256(model_path.read_bytes()).hexdigest()!=model_hash:
                raise RuntimeError('AI model checksum mismatch')
            cv2.setNumThreads(4)
            model=cv2.dnn_superres.DnnSuperResImpl_create()
            model.readModel(str(model_path));model.setModel('fsrcnn',2);_MODEL=model
        # Legacy engine is explicitly a fallback; resize only its 2x result, never its input.
        bgr=cv2.cvtColor(frame,cv2.COLOR_RGB2BGR)
        restored=cv2.resize(_MODEL.upsample(bgr),(width,height),interpolation=cv2.INTER_AREA)
        if protect_text:
            # Conservative edge protection is not OCR. Preserve high-frequency strokes,
            # including UI edges, instead of hallucinating replacements.
            gray=cv2.cvtColor(bgr,cv2.COLOR_BGR2GRAY)
            edges=cv2.Canny(gray,60,140)
            mask=cv2.dilate(edges,np.ones((3,3),np.uint8)).astype(bool)
            weak=cv2.bilateralFilter(bgr,3,4,4)
            restored[mask]=weak[mask]
        output=cv2.cvtColor(restored,cv2.COLOR_BGR2RGB)
    return output.tobytes(),(time.perf_counter()-started)*1000
