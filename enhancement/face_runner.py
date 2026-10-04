"""Stream decoded frames through CodeFormer without retaining a video in RAM."""
import argparse
import json
import subprocess
import sys
from pathlib import Path


def read_frame(stream, size):
    data = bytearray()
    while len(data) < size:
        block = stream.read(size - len(data))
        if not block: break
        data.extend(block)
    if data and len(data) != size: raise ValueError('Incomplete decoded video frame')
    return data


def main():
    parser = argparse.ArgumentParser()
    for name in ('source', 'output', 'encoding'): parser.add_argument('--'+name, required=True)
    for name in ('width', 'height'): parser.add_argument('--'+name, type=int, required=True)
    for name in ('fps', 'duration', 'start', 'fidelity', 'blend'): parser.add_argument('--'+name, type=float, required=True)
    args = parser.parse_args()
    progress = sys.stdout
    # Upstream diagnostic prints must never contaminate structured progress.
    sys.stdout = sys.stderr
    from face import ENGINE, WEIGHTS
    sys.path.insert(0, str(ENGINE))
    import cv2
    import numpy as np
    import torch
    from torchvision.transforms.functional import normalize
    from basicsr.archs.codeformer_arch import CodeFormer
    from basicsr.utils import img2tensor, tensor2img
    from facelib.utils.face_restoration_helper import FaceRestoreHelper
    from basicsr.utils.misc import get_device
    for name in WEIGHTS:
        if not (ENGINE / name).is_file(): raise ValueError('Required face weights are missing; rerun install-face.command')
    device = get_device()
    torch.set_num_threads(4)
    net = CodeFormer(dim_embd=512, codebook_size=1024, n_head=8, n_layers=9, connect_list=['32', '64', '128', '256']).to(device)
    net.load_state_dict(torch.load(str(ENGINE / WEIGHTS[0]), map_location='cpu', weights_only=True)['params_ema'])
    net.eval()
    helper = FaceRestoreHelper(1, face_size=512, crop_ratio=(1, 1), det_model='retinaface_resnet50', save_ext='png', use_parse=True, device=device)
    options = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm']
    seek = ['-ss', str(args.start)] if args.start else []
    trim = ['-t', str(args.duration)] if args.duration else []
    decoder = encoder = None
    frames = restored_frames = 0
    try:
        decoder = subprocess.Popen(['ffmpeg', '-nostdin', '-v', 'error', *options, *seek, '-i', args.source, *trim, '-map', '0:v:0', '-vf', f'fps={args.fps}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'], stdout=subprocess.PIPE)
        encoder = subprocess.Popen(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{args.width}x{args.height}', '-r', str(args.fps), '-i', 'pipe:0', *options, *seek, '-i', args.source, *trim, '-map', '0:v:0', '-map', '1:a:0?', '-shortest', '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', *json.loads(args.encoding), args.output], stdin=subprocess.PIPE)
        while True:
            data = read_frame(decoder.stdout, args.width*args.height*3)
            if not data: break
            frame = np.frombuffer(data, dtype=np.uint8).reshape(args.height, args.width, 3).copy()
            helper.clean_all(); helper.read_image(frame)
            count = helper.get_face_landmarks_5(only_center_face=False, resize=640, eye_dist_threshold=5)
            if count:
                helper.align_warp_face()
                for cropped in helper.cropped_faces:
                    tensor = img2tensor(cropped/255., bgr2rgb=True, float32=True)
                    normalize(tensor, (.5,)*3, (.5,)*3, inplace=True)
                    with torch.inference_mode():
                        result = net(tensor.unsqueeze(0).to(device), w=args.fidelity, adain=True)[0]
                    restored = tensor2img(result, rgb2bgr=True, min_max=(-1, 1))
                    restored = cv2.addWeighted(restored, args.blend, cropped, 1-args.blend, 0)
                    helper.add_restored_face(restored, cropped)
                helper.get_inverse_affine(None)
                frame = helper.paste_faces_to_input_image()
                restored_frames += 1
            encoder.stdin.write(frame.tobytes()); frames += 1
            progress.write(json.dumps({'progress': frames/max(1, args.duration*args.fps), 'restoredFrames': restored_frames})+'\n'); progress.flush()
        encoder.stdin.close()
        if decoder.wait() or encoder.wait() or not frames: raise ValueError('Video decoding or encoding failed')
        if not restored_frames: raise ValueError('No usable face detected. Heavy masking cannot be reliably restored; choose a clearer clip.')
    finally:
        for process in (decoder, encoder):
            if process and process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()


if __name__ == '__main__':
    report = sys.stdout
    try: main()
    except Exception as error:
        report.write(json.dumps({'error': str(error)})+'\n'); report.flush()
        sys.exit(1)
