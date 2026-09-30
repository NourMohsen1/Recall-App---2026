# Converts Marqo/nsfw-image-detection-384 (Apache-2.0, a ViT-tiny/16 at
# 384 px) to Core ML for the on-device private-photo check
# (modules/photo-guard). Run from the scratchpad with the venv described in
# tools/photo-model/README.md, plus `timm`.
#
#   python convert.py <out_dir> [test images…]
#
# Checks the converted model against PyTorch on the given images before
# trusting it, and prints how sure each is that an image is NSFW.
import sys, numpy as np, torch, timm, coremltools as ct
from PIL import Image

out = sys.argv[1]
tests = sys.argv[2:]

model = timm.create_model("hf_hub:Marqo/nsfw-image-detection-384", pretrained=True).eval()
cfg = timm.data.resolve_data_config({}, model=model)
tf = timm.data.create_transform(**cfg, is_training=False)
print("params: %.1fM" % (sum(p.numel() for p in model.parameters()) / 1e6), "| config:", cfg)


class Probabilities(torch.nn.Module):
    """Outputs [P(NSFW), P(SFW)] so the app needs no maths of its own."""

    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, x):
        return torch.softmax(self.m(x), dim=-1)


wrapped = Probabilities(model).eval()
example = torch.rand(1, 3, 384, 384) * 2 - 1
with torch.no_grad():
    traced = torch.jit.trace(wrapped, example)

# Input: an RGB image, scaled to [-1, 1] inside the model (mean 0.5, std 0.5).
ml = ct.convert(
    traced,
    inputs=[ct.ImageType(name="image", shape=(1, 3, 384, 384), scale=2 / 255.0, bias=[-1, -1, -1],
                         color_layout=ct.colorlayout.RGB)],
    outputs=[ct.TensorType(name="probabilities")],
    compute_precision=ct.precision.FLOAT16,
    minimum_deployment_target=ct.target.iOS17,
)
ml.short_description = "Marqo nsfw-image-detection-384 (Apache-2.0). Output: [P(NSFW), P(SFW)]."
ml.save(f"{out}/PrivatePhoto.mlpackage")

for p in tests:
    im = Image.open(p).convert("RGB")
    with torch.no_grad():
        ref = wrapped(tf(im).unsqueeze(0))[0].numpy()
    got = ml.predict({"image": im.resize((384, 384), Image.BICUBIC)})["probabilities"][0]
    print(f"{p.split('/')[-1][:22]:22s} NSFW: torch {ref[0]:.4f}  coreml {got[0]:.4f}")
