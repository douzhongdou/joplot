"""由源图生成应用图标与导航栏 logo。

用法（在仓库根目录执行）：

    python apps/image/tools/make-icons.py

源图放在 `apps/image/` 下（改完图重跑本脚本即可）：

- `jo.png`      方块标识 → 浏览器标签 favicon 与 iOS 主屏图标
- `joimage.png` 横版组合 logo（图标与名字都在图里）→ 左上角导航栏

产物：

- `apps/image/app/icon.png`            192×192
- `apps/image/app/apple-icon.png`      180×180
- `apps/image/app/favicon.ico`         16 / 32 / 48 多尺寸
- `apps/image/public/navbar-icon.webp` 高 128（宽度按原比例）

favicon 源图不是正方形时按中心裁成正方形再缩放，否则各尺寸会被拉变形。
"""

from pathlib import Path

from PIL import Image

APP_DIR = Path(__file__).resolve().parents[1]
APP = APP_DIR / "app"
PUBLIC = APP_DIR / "public"

FAVICON_SOURCE = APP_DIR / "jo.png"
LOGO_SOURCE = APP_DIR / "joimage.png"

FAVICON_SIZES = {"icon.png": 192, "apple-icon.png": 180}
FAVICON_ICO_SIZES = [(16, 16), (32, 32), (48, 48)]
NAVBAR_HEIGHT = 128

# Pillow 10 起 LANCZOS 收进 Resampling 枚举，这里兼容新旧写法。
RESAMPLE = getattr(Image, "Resampling", Image).LANCZOS


def square(image: Image.Image) -> Image.Image:
    """中心裁成正方形：favicon 的每种尺寸都必须是方的。"""
    if image.width == image.height:
        return image
    side = min(image.width, image.height)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    return image.crop((left, top, left + side, top + side))


def main() -> None:
    PUBLIC.mkdir(parents=True, exist_ok=True)

    favicon = Image.open(FAVICON_SOURCE).convert("RGBA")
    print(f"{FAVICON_SOURCE.name}: {favicon.width}x{favicon.height}")
    favicon = square(favicon)

    for name, size in FAVICON_SIZES.items():
        favicon.resize((size, size), RESAMPLE).save(APP / name, optimize=True)
    favicon.resize((256, 256), RESAMPLE).save(
        APP / "favicon.ico", sizes=FAVICON_ICO_SIZES
    )

    logo = Image.open(LOGO_SOURCE).convert("RGBA")
    print(f"{LOGO_SOURCE.name}: {logo.width}x{logo.height}")
    width = round(logo.width * NAVBAR_HEIGHT / logo.height)
    logo.resize((width, NAVBAR_HEIGHT), RESAMPLE).save(
        PUBLIC / "navbar-icon.webp", quality=92, method=6
    )

    outputs = [APP / name for name in FAVICON_SIZES] + [
        APP / "favicon.ico",
        PUBLIC / "navbar-icon.webp",
    ]
    for path in outputs:
        with Image.open(path) as check:
            print(f"  {path.name}: {check.width}x{check.height} {check.format} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
