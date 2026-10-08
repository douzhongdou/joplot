"""生成 plot 应用的导航栏 logo 与图标。

用法（在仓库根目录执行）：

    python apps/plot/tools/make-icons.py

品牌源图统一放在 `apps/image/` 下：

- `jo.png`      方块标识（绿底白字）→ 两个应用共用的 favicon
- `joimage.png` 横版组合 logo：左侧方块 + 右侧 "image" 字样

plot 的横版 logo 是**画出来**的：左侧方块直接取自 `joimage.png`（与 image 用的那份
逐像素相同），右侧的 "plot" 用同一款字体 Zilla Slab Bold 渲染，字号由原图 "image"
的包围盒反推、基线也对齐，因此两个应用的 logo 视觉一致。

产物（`apps/plot/public/`，文件名与 `manifest.webmanifest` 的引用保持一致）：

- `navbar-icon.webp`      左上角横版 logo（高 {height}）
- `icon-32.png`           32×32
- `icon-192.png`          192×192
- `icon.webp`             500×500
- `apple-touch-icon.png`  180×180
- `favicon.ico`           16 / 32 / 48

字体按 SIL Open Font License 分发，许可原文见同目录的 `fonts/OFL.txt`。
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PLOT_DIR = Path(__file__).resolve().parents[1]
TOOLS_DIR = Path(__file__).resolve().parent
IMAGE_DIR = PLOT_DIR.parent / "image"
PUBLIC = PLOT_DIR / "public"

FONT_PATH = TOOLS_DIR / "fonts" / "ZillaSlab-Bold.ttf"
FAVICON_SOURCE = IMAGE_DIR / "jo.png"
LOGO_SOURCE = IMAGE_DIR / "joimage.png"

GREEN = (62, 189, 36, 255)
NAVBAR_HEIGHT = 128
FAVICON_SIZES = {"icon-32.png": 32, "icon-192.png": 192, "apple-touch-icon.png": 180}
FAVICON_ICO_SIZES = [(16, 16), (32, 32), (48, 48)]

# 量自 joimage.png：方块尺寸，以及参考词 "image" 的包围盒（用来反推字号与基线）。
BLOCK_W, CANVAS_H = 486, 512
REF_LEFT, REF_TOP, REF_RIGHT, REF_BOTTOM = 513, 43, 1856, 458

RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS


def square(image: Image.Image) -> Image.Image:
    """中心裁成正方形：favicon 的每种尺寸都必须是方的。"""
    if image.width == image.height:
        return image
    side = min(image.width, image.height)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side))


def build_navbar_logo(word: str) -> Image.Image:
    source = Image.open(LOGO_SOURCE).convert("RGBA")
    block = source.crop((0, 0, BLOCK_W, CANVAS_H))

    ref_height = REF_BOTTOM - REF_TOP + 1
    probe = ImageFont.truetype(str(FONT_PATH), 100)
    _, top, _, bottom = probe.getbbox("image")
    size = max(1, round(100 * ref_height / (bottom - top)))
    font = ImageFont.truetype(str(FONT_PATH), size)

    # 让参考词 "image" 的包围盒左上角正好落在原图的位置：算出绘制原点。
    left, top, _, _ = font.getbbox("image")
    origin_x = REF_LEFT - left
    origin_y = REF_TOP - top

    _, _, right, _ = font.getbbox(word)
    canvas = Image.new("RGBA", (origin_x + right, CANVAS_H), (0, 0, 0, 0))
    canvas.paste(block, (0, 0))
    ImageDraw.Draw(canvas).text((origin_x, origin_y), word, font=font, fill=GREEN)
    print(f"  font size {size}px, canvas {canvas.width}x{CANVAS_H}")
    return canvas


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    logo = build_navbar_logo("plot")
    logo.resize(
        (round(logo.width * NAVBAR_HEIGHT / logo.height), NAVBAR_HEIGHT), RESAMPLE
    ).save(PUBLIC / "navbar-icon.webp", quality=92, method=6)

    favicon = square(Image.open(FAVICON_SOURCE).convert("RGBA"))
    for name, size in FAVICON_SIZES.items():
        favicon.resize((size, size), RESAMPLE).save(PUBLIC / name, optimize=True)
    favicon.resize((500, 500), RESAMPLE).save(PUBLIC / "icon.webp", quality=92, method=6)
    favicon.resize((256, 256), RESAMPLE).save(
        PUBLIC / "favicon.ico", sizes=FAVICON_ICO_SIZES
    )

    outputs = ["navbar-icon.webp", *FAVICON_SIZES, "icon.webp", "favicon.ico"]
    for name in outputs:
        path = PUBLIC / name
        with Image.open(path) as check:
            print(f"  {name}: {check.width}x{check.height} {check.format} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
