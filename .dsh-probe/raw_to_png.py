import numpy as np
from PIL import Image

H, W = 3052, 4072
src = r'D:\HQL\code\tool\joplot\apps\image\.dsh-probe-e2e.raw'
out = r'D:\HQL\code\tool\joplot\.dsh-probe\out'
a = np.fromfile(src, np.uint8)
assert a.size == H * W * 3, a.size
img = a.reshape(3, H, W).transpose(1, 2, 0)          # planar RGB -> HxWx3

Image.fromarray(img).save(out + r'\e2e_baseline_full.png', optimize=True)
lo, hi = np.percentile(img, [0.1, 99.9])
print('baseline stats: mean', img.mean(), 'as-is percentiles', lo, hi)
st = np.clip((img.astype(np.float32) - lo) * 255 / max(hi - lo, 1), 0, 255).astype(np.uint8)
Image.fromarray(st[::4, ::4]).save(out + r'\e2e_stretched_thumb.png')
print('saved')
