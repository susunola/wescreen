"""Mark optional GPU backend ready only after real inference succeeds."""
import json
import sys
import time
import numpy as np
from smart_model import NeuralRepair, ROOT, DIRECTORY, HASHES

model=NeuralRepair();rng=np.random.default_rng(7)
frame=rng.integers(0,256,(64,96,3),dtype=np.uint8)
start=time.perf_counter();output=model(frame,2)
assert output.shape==(128,192,3) and output.dtype==np.uint8
report={'tested':True,'python':sys.executable,'device':model.device,'files':{name:{'size':(DIRECTORY/name).stat().st_size,'mtime_ns':(DIRECTORY/name).stat().st_mtime_ns} for name in HASHES}}
(ROOT/'.runtime'/'smart-ready.json').write_text(json.dumps(report))
print(json.dumps({'device':model.device,'input':[96,64],'output':[192,128],'ms':round((time.perf_counter()-start)*1000)}))
