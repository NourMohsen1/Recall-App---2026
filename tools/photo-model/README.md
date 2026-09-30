# On-device photo model — parked

Tested in September 2026 and parked. Kept so the work can be picked up again.

**What was tried.** Google's SigLIP 2 base/16 (Apache-2.0) image encoder, converted
to Core ML (`convert.py`, with the pooling head's attention rewritten so it
converts), palettized to 8 bits (`palettize.py`, 88 MB), plus a 108-concept
vocabulary embedded on the Mac (`vocab.py`). MobileCLIP was ruled out first:
Apple's terms for its weights allow research use only.

**What it measured** on Nour's iPhone 14 Pro Max over 20 real days: 9 ms per
photo on the Neural Engine, and the right *kind* of scene most days (kitchen,
cat, receipt, car, TV) — but no details, no text, no story. Next to DeepSeek's
day descriptions it was of no use to someone trying to remember a day, which
is the whole point of the feature. Photo stories stay with an AI service the
user opts into.

**To revisit** when phones can run a vision-language model that writes real
descriptions at a reasonable size. The native module and test screen are in
git history at commit `06e3089`.
