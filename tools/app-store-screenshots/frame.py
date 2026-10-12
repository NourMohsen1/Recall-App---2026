# Recall's App Store screenshots in the style of Nour's reference: light and
# dark slides alternating, a two-line headline with one word marked (a pill
# or the accent colour), a short line under it, the real screen in a black
# phone with a soft glow, and a few hand-drawn touches. Only the app's own
# font (Poppins) and colours (src/theme.ts).
import math, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

K = 2                       # drawn at 2x, then scaled down: smooth edges
W, H = 1320 * K, 2868 * K
P = '/Users/n/Recall-App---2026/node_modules/@expo-google-fonts/poppins/'
F_HEAD = ImageFont.truetype(P + '700Bold/Poppins_700Bold.ttf', 112 * K)
F_SUB = ImageFont.truetype(P + '600SemiBold/Poppins_600SemiBold.ttf', 50 * K)

PRIMARY = (41, 84, 90)      # #29545A
TEAL = (51, 105, 112)       # #336970
ACCENT = (99, 188, 198)     # #63BCC6
PALE = (214, 225, 226)      # #D6E1E2
LIGHT_BG = (226, 235, 236)
WHITE = (255, 255, 255)

def rgba(c, a):
    return (c[0], c[1], c[2], a)

# ── hand-drawn touches ──────────────────────────────────────────────────

def blob(layer, cx, cy, r, color, alpha, seed):
    rnd = random.Random(seed)
    m = Image.new('L', layer.size, 0)
    d = ImageDraw.Draw(m)
    for _ in range(7):
        a = rnd.uniform(0, 2 * math.pi)
        dist = rnd.uniform(0, r * 0.55)
        rr = rnd.uniform(r * 0.45, r * 0.8)
        x, y = cx + math.cos(a) * dist, cy + math.sin(a) * dist
        d.ellipse((x - rr, y - rr, x + rr, y + rr), fill=255)
    m = m.filter(ImageFilter.GaussianBlur(r * 0.18)).point(lambda v: 255 if v > 128 else 0)
    m = m.filter(ImageFilter.GaussianBlur(2 * K)).point(lambda v: v * alpha // 255)
    layer.paste(Image.new('RGBA', layer.size, rgba(color, 255)), mask=m) if False else layer.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', layer.size, color).split(), m)))

def sparkle(d, cx, cy, s, color):
    pts = []
    for i in range(8):
        a = i * math.pi / 4 - math.pi / 2
        rr = s if i % 2 == 0 else s * 0.28
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    d.polygon(pts, fill=color)

def stroke(d, pts, color, w):
    d.line(pts, fill=color, width=w, joint='curve')
    for x, y in (pts[0], pts[-1]):
        d.ellipse((x - w / 2, y - w / 2, x + w / 2, y + w / 2), fill=color)

def squiggle(d, x, y, length, color, w=7 * K, waves=5, amp=14 * K):
    pts = [(x + t, y + math.sin(t / length * waves * 2 * math.pi) * amp) for t in range(0, int(length), 4)]
    stroke(d, pts, color, w)

def swoosh(d, x, y, length, color, w=12 * K):
    pts = [(x + t, y - math.sin(t / length * math.pi) * 22 * K + t * 0.04) for t in range(0, int(length), 4)]
    stroke(d, pts, color, w)

def burst(d, cx, cy, color, n=4, r0=40 * K, r1=95 * K, start=200, spread=70, w=9 * K):
    for i in range(n):
        a = math.radians(start + i * spread / max(1, n - 1))
        stroke(d, [(cx + math.cos(a) * r0, cy + math.sin(a) * r0), (cx + math.cos(a) * r1, cy + math.sin(a) * r1)], color, w)

def curl_arrow(d, x, y, color, w=6 * K, s=1.0):
    pts = []
    for i in range(60):
        t = i / 59
        a = t * 2.4 * math.pi
        pts.append((x + (60 * t + 28 * math.sin(a)) * K * s, y + (150 * t + 28 * (1 - math.cos(a))) * K * s))
    stroke(d, pts, color, w)
    ex, ey = pts[-1]
    px, py = pts[-6]
    ang = math.atan2(ey - py, ex - px)
    for da in (2.6, -2.6):
        stroke(d, [(ex, ey), (ex + math.cos(ang + da) * 28 * K * s, ey + math.sin(ang + da) * 28 * K * s)], color, w)

# ── headline ────────────────────────────────────────────────────────────

def headline(img, lines, y, dark, align='center', x0=110 * K):
    """lines: [[(text, 'plain'|'pill'|'accent'), …], …]"""
    d = ImageDraw.Draw(img)
    ink = WHITE if dark else PRIMARY
    pad_x, pad_y = 30 * K, 10 * K
    lh = 132 * K
    for i, segs in enumerate(lines):
        widths = [F_HEAD.getlength(t) + (2 * pad_x if s == 'pill' else 0) for t, s in segs]
        gap = F_HEAD.getlength(' ')
        total = sum(widths) + gap * (len(segs) - 1)
        x = (W - total) / 2 if align == 'center' else x0
        top = y + i * lh
        for (t, s), wdt in zip(segs, widths):
            if s == 'pill':
                fill = WHITE if dark else PRIMARY
                d.rounded_rectangle((x, top + 6 * K, x + wdt, top + lh - 6 * K), 34 * K, fill=fill)
                d.text((x + pad_x, top + lh / 2 + 4 * K), t, font=F_HEAD, fill=PRIMARY if dark else WHITE, anchor='lm')
            else:
                color = ACCENT if s == 'accent' else ink
                d.text((x, top + lh / 2 + 4 * K), t, font=F_HEAD, fill=color, anchor='lm')
            x += wdt + gap
    return y + len(lines) * lh

# ── the phone ───────────────────────────────────────────────────────────

def phone(img, shot_path, top, dark):
    shot = Image.open(shot_path).convert('RGB')
    sw = 880 * K
    sh = round(shot.height * sw / shot.width)
    shot = shot.resize((sw, sh), Image.LANCZOS)
    bez, r = 26 * K, 150 * K
    x = (W - sw) // 2
    fx0, fy0, fx1, fy1 = x - bez, top - bez, x + sw + bez, top + sh + bez
    # glow behind it
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).rounded_rectangle((fx0 + 40 * K, fy0 + 60 * K, fx1 - 40 * K, fy1), r, fill=190 if dark else 120)
    glow = glow.filter(ImageFilter.GaussianBlur(70 * K))
    img.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (W, H), ACCENT if dark else TEAL).split(), glow)))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((fx0, fy0, fx1, fy1), r, fill=(12, 15, 16))
    d.rounded_rectangle((fx0 + 4 * K, fy0 + 4 * K, fx1 - 4 * K, fy1 - 4 * K), r - 4 * K, outline=(70, 78, 80), width=3 * K)
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw, sh), r - bez, fill=255)
    img.paste(shot, (x, top), mask)
    # the Dynamic Island, where the real phone has it
    iw, ih, iy = 250 * K, 72 * K, top + 26 * K
    d.rounded_rectangle((W / 2 - iw / 2, iy, W / 2 + iw / 2, iy + ih), ih / 2, fill=(0, 0, 0))

# ── the slides ──────────────────────────────────────────────────────────

SLIDES = [
    ('1-home', False, [[('Your Days,', 'plain')], [('Remembered', 'pill')]], 'Talk, type or snap. Recall files the rest.', 'home'),
    ('8-ask-brain', True, [[('Ask Your', 'plain')], [('Memory', 'accent')]], 'Speak or type, in any language', 'ask'),
    ('2-ask', False, [[('Find Details', 'plain')], [('Fast', 'pill')]], 'Real answers from your own days', 'fast'),
    ('3-timeline', True, [[('Remember With', 'plain')], [('Context', 'accent')]], 'Linked to who, when and where', 'context'),
    ('9-canvas', False, [[('Every Day,', 'plain')], [('One', 'plain'), ('Canvas', 'pill')]], 'Move things around. It all stays linked.', 'canvas'),
    ('4-people', True, [[('Everyone', 'plain')], [('You', 'plain'), ('Love', 'pill')]], 'People fill in from what you log', 'people'),
    ('5-recap', False, [[('Your Week,', 'plain')], [('At a Glance', 'pill')]], 'A short recap, day by day', 'recap'),
    ('6-tasks', True, [[('Keep Life', 'plain')], [('Organized', 'accent')]], 'Tasks from what you say', 'tasks'),
]

def touches(img, kind, dark):
    lay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    soft = rgba(WHITE, 40) if dark else rgba(TEAL, 34)
    line = rgba(WHITE, 210) if dark else rgba(PRIMARY, 200)
    acc = rgba(ACCENT, 230)
    # big soft shapes behind the phone, different on every slide
    seeds = {'home': 3, 'ask': 5, 'fast': 7, 'context': 11, 'canvas': 23, 'people': 13, 'recap': 17, 'tasks': 19}
    s = seeds[kind]
    blob(lay, W * 0.08, H * 0.62, 240 * K, WHITE if dark else TEAL, 26 if dark else 30, s)
    blob(lay, W * 0.95, H * 0.36, 300 * K, WHITE if dark else TEAL, 22 if dark else 24, s + 1)
    blob(lay, W * 0.9, H * 0.9, 220 * K, WHITE if dark else TEAL, 20 if dark else 26, s + 2)
    d = ImageDraw.Draw(lay)
    if kind == 'home':
        sparkle(d, W * 0.86, 150 * K, 46 * K, line); sparkle(d, W * 0.92, 245 * K, 24 * K, line)
        squiggle(d, W * 0.32, 520 * K, W * 0.36, line)
    elif kind == 'ask':
        curl_arrow(d, W * 0.83, 170 * K, line)
        sparkle(d, W * 0.13, 520 * K, 30 * K, acc)
    elif kind == 'fast':
        burst(d, W * 0.13, 300 * K, line, start=200, spread=80)
        swoosh(d, W * 0.3, 545 * K, W * 0.4, line)
    elif kind == 'context':
        sparkle(d, W * 0.88, 470 * K, 40 * K, acc); sparkle(d, W * 0.12, 160 * K, 26 * K, line)
        swoosh(d, W * 0.32, 545 * K, W * 0.36, acc)
    elif kind == 'canvas':
        curl_arrow(d, W * 0.84, 150 * K, line)
        squiggle(d, W * 0.33, 520 * K, W * 0.34, line)
    elif kind == 'people':
        burst(d, W * 0.87, 300 * K, line, start=-20, spread=80)
        squiggle(d, W * 0.33, 520 * K, W * 0.34, line)
    elif kind == 'recap':
        swoosh(d, W * 0.25, 545 * K, W * 0.5, line)
        sparkle(d, W * 0.88, 170 * K, 36 * K, acc)
    elif kind == 'tasks':
        sparkle(d, W * 0.12, 180 * K, 40 * K, line); sparkle(d, W * 0.19, 270 * K, 20 * K, line)
        burst(d, W * 0.88, 420 * K, line, start=-30, spread=60, n=3)
    img.alpha_composite(lay)

# Usage: python frame.py captures ../../docs/app-store-screenshots
#        (needs Pillow; captures are named as in SLIDES)
src, out = sys.argv[1], sys.argv[2]
for name, dark, lines, sub, kind in SLIDES:
    img = Image.new('RGBA', (W, H), rgba(PRIMARY if dark else LIGHT_BG, 255))
    # light from the top on dark slides, so the teal isn't flat
    if dark:
        g = Image.new('L', (W, H), 0)
        ImageDraw.Draw(g).ellipse((-W * 0.3, -H * 0.35, W * 1.3, H * 0.35), fill=60)
        img.alpha_composite(Image.merge('RGBA', (*Image.new('RGB', (W, H), (70, 130, 138)).split(), g.filter(ImageFilter.GaussianBlur(200 * K)))))
    touches(img, kind, dark)
    y = headline(img, lines, 150 * K, dark)
    ImageDraw.Draw(img).text((W / 2, y + 26 * K), sub, font=F_SUB, fill=PALE if dark else TEAL, anchor='mt')
    phone(img, f'{src}/{name}.png', 700 * K, dark)
    order = [n for n, *_ in SLIDES].index(name) + 1
    slug = name.split('-', 1)[1]
    img.convert('RGB').resize((W // K, H // K), Image.LANCZOS).save(f'{out}/{order}-{slug}.png')
    print('done', name)
