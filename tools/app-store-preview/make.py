# Recall's App Preview: the real app recorded on the simulator, framed like
# the approved screenshots (teal, Poppins headline, phone frame), 886x1920,
# 30 fps, H.264, silent, looping back to its first frame.
import sys, numpy as np, imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageFilter

D = sys.argv[1]
W, H, FPS = 886, 1920, 30
P = '/Users/n/Recall-App---2026/node_modules/@expo-google-fonts/poppins/'
F_HEAD = ImageFont.truetype(P + '700Bold/Poppins_700Bold.ttf', 74)
PRIMARY, ACCENT, LIGHT, WHITE = (41, 84, 90), (99, 188, 198), (226, 235, 236), (255, 255, 255)

SW = 690                      # the screen's width in the video
SH = round(SW * 2868 / 1320)  # 1499
SX, SY = (W - SW) // 2, H - SH - 64
BEZ, R = 16, 92

def frames(path, start, dur):
    """RGB frames of a clip at 30 fps, from start for dur seconds."""
    gen = imageio_ffmpeg.read_frames(path, input_params=['-ss', str(start)], output_params=['-t', str(dur), '-r', str(FPS)])
    meta = next(gen)
    w, h = meta['size']
    for b in gen:
        yield Image.frombytes('RGB', (w, h), b)

def hide_note(im, top, bottom):
    """Covers the simulator-only 'Recall's AI is off' line with the band above it."""
    h = bottom - top
    im.paste(im.crop((0, top - h - 6, im.width, top - 6)), (0, top))
    return im

def headline(dark, lines):
    bg = Image.new('RGB', (W, H), PRIMARY if dark else LIGHT)
    if dark:
        glow = Image.new('L', (W, H), 0)
        ImageDraw.Draw(glow).ellipse((-W * 0.3, -H * 0.3, W * 1.3, H * 0.3), fill=60)
        bg.paste(Image.new('RGB', (W, H), (70, 130, 138)), mask=glow.filter(ImageFilter.GaussianBlur(160)))
    d = ImageDraw.Draw(bg)
    ink = WHITE if dark else PRIMARY
    lh, y0 = 96, 120
    for i, segs in enumerate(lines):
        gap = F_HEAD.getlength(' ')
        widths = [F_HEAD.getlength(t) + (44 if s == 'pill' else 0) for t, s in segs]
        x = (W - sum(widths) - gap * (len(segs) - 1)) / 2
        top = y0 + i * lh
        for (t, s), w in zip(segs, widths):
            if s == 'pill':
                d.rounded_rectangle((x, top + 4, x + w, top + lh - 4), 28, fill=WHITE if dark else PRIMARY)
                d.text((x + 22, top + lh / 2 + 3), t, font=F_HEAD, fill=PRIMARY if dark else WHITE, anchor='lm')
            else:
                d.text((x, top + lh / 2 + 3), t, font=F_HEAD, fill=ACCENT if s == 'accent' else ink, anchor='lm')
            x += w + gap
    # the phone: glow, bezel, edge
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).rounded_rectangle((SX + 30, SY + 50, SX + SW - 30, H), R, fill=170 if dark else 110)
    bg.paste(Image.new('RGB', (W, H), ACCENT if dark else (51, 105, 112)), mask=glow.filter(ImageFilter.GaussianBlur(50)))
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((SX - BEZ, SY - BEZ, SX + SW + BEZ, SY + SH + BEZ), R + BEZ, fill=(12, 15, 16))
    d.rounded_rectangle((SX - BEZ + 3, SY - BEZ + 3, SX + SW + BEZ - 3, SY + SH + BEZ - 3), R + BEZ - 3, outline=(70, 78, 80), width=2)
    return bg

MASK = Image.new('L', (SW, SH), 0)
ImageDraw.Draw(MASK).rounded_rectangle((0, 0, SW, SH), R, fill=255)

def compose(bg, screen):
    out = bg.copy()
    out.paste(screen.resize((SW, SH), Image.LANCZOS), (SX, SY), MASK)
    return out

def still(path, dur):
    im = Image.open(path).convert('RGB')
    for _ in range(int(dur * FPS)):
        yield im.copy()

SCENES = [
    # (frames, dark, headline)
    (lambda: (hide_note(f, 2368, 2408) for f in frames(f'{D}/s1.mov', 0.4, 3.6)), True, [[('Your Days,', 'plain')], [('Remembered', 'pill')]]),
    (lambda: (hide_note(f, 1526, 1582) for f in frames(f'{D}/s2a.mov', 0.6, 5.4)), True, [[('Ask Your', 'plain')], [('Memory', 'accent')]]),
    (lambda: (hide_note(f, 2368, 2408) for f in still(f'{D}/answer.png', 3.0)), True, [[('Real Answers,', 'plain')], [('From Your Days', 'pill')]]),
    (lambda: frames(f'{D}/s3.mov', 0.2, 3.6), False, [[('Every Day,', 'plain')], [('One', 'plain'), ('Canvas', 'pill')]]),
    (lambda: frames(f'{D}/s4.mov', 0.0, 3.7), False, [[('Your Week,', 'plain')], [('At a Glance', 'pill')]]),
]

XF = int(0.4 * FPS)  # cross-fade length
writer = imageio_ffmpeg.write_frames(
    f'{D}/preview-raw.mp4', (W, H), fps=FPS, codec='libx264', pix_fmt_out='yuv420p', macro_block_size=2,
    output_params=['-profile:v', 'high', '-level', '4.0', '-crf', '10', '-movflags', '+faststart'],
)
writer.send(None)
prev_tail, count, first = [], 0, None
for make, dark, lines in SCENES:
    bg = headline(dark, lines)
    cur = [compose(bg, f) for f in make()]
    if first is None:
        first = cur[0]
    if prev_tail:
        for i in range(XF):
            a = (i + 1) / (XF + 1)
            cur[i] = Image.blend(prev_tail[i], cur[i], a)
    for im in cur[:-XF]:
        writer.send(np.asarray(im).tobytes()); count += 1
    prev_tail = cur[-XF:]
# loop: the last frames fade into the first, so the video joins itself
for i in range(XF):
    a = (i + 1) / (XF + 1)
    writer.send(np.asarray(Image.blend(prev_tail[i], first, a)).tobytes()); count += 1
writer.close()
print('frames', count, 'seconds', round(count / FPS, 2))
