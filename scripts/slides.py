"""Render one 1280x720 slide PNG per lecture section (title|subtitle lines in lecture.txt)."""
import sys
from PIL import Image, ImageDraw, ImageFont

src, out_dir = sys.argv[1], sys.argv[2]
lines = open(src).read().strip().split("\n")
sections = [(lines[i], lines[i + 1]) for i in range(0, len(lines), 2)]
bold = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 72)
small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 32)
for n, (header, _) in enumerate(sections):
    title, subtitle = header.split("|")
    img = Image.new("RGB", (1280, 720))
    d = ImageDraw.Draw(img)
    for y in range(720):  # vertical gradient
        t = y / 720
        d.line([(0, y), (1280, y)], fill=(int(30 + 20 * t), int(24 + 10 * t), int(70 - 40 * t)))
    d.rounded_rectangle([80, 80, 300, 128], 24, fill=(124, 108, 255))
    d.text((100, 88), f"PART {n + 1} / {len(sections)}", font=small, fill="white")
    d.text((80, 280), title, font=bold, fill="white")
    d.text((80, 380), subtitle, font=small, fill=(200, 195, 255))
    d.ellipse([1000, 420, 1180, 600], outline=(124, 108, 255), width=6)
    img.save(f"{out_dir}/slide{n}.png")
    open(f"{out_dir}/text{n}.txt", "w").write(sections[n][1])
print(len(sections))
