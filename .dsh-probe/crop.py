import os
from PIL import Image

src = r"C:\Users\admin\.dsh\attachments\v1\objects\22\2200ff10adeca087e4ba8184bdc00bde64b9b0b4a640cb856d53d4e4069a3a91"
out = r"D:\HQL\code\tool\joplot\.dsh-probe\out"
os.makedirs(out, exist_ok=True)
im = Image.open(src)
print("source", im.size, im.mode)

# ② 顶部状态栏整条
bar = im.crop((1150, 0, im.width, 40)).resize(((im.width - 1150) * 4, 160), Image.LANCZOS)
bar.save(os.path.join(out, "crop_statusbar.png"))

# ③ 画布上的标注文字
lab = im.crop((680, 700, 1000, 800)).resize((320 * 4, 100 * 4), Image.LANCZOS)
lab.save(os.path.join(out, "crop_label.png"))
print("ok")
