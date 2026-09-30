import torch, numpy as np, coremltools as ct, time, json
from transformers import AutoModel, AutoProcessor
from PIL import Image
NAME = "google/siglip2-base-patch16-224"
model = AutoModel.from_pretrained(NAME, attn_implementation="eager").eval()
print(type(model).__name__, model.config._attn_implementation)
proc = AutoProcessor.from_pretrained(NAME)
print("params: vision %.1fM, text %.1fM" % (sum(p.numel() for p in model.vision_model.parameters())/1e6, sum(p.numel() for p in model.text_model.parameters())/1e6))
print("image processor:", {k: getattr(proc.image_processor, k, None) for k in ["size", "image_mean", "image_std", "rescale_factor", "resample", "do_center_crop"]})

# The pooling head uses torch's MultiheadAttention, which the Core ML
# converter cannot trace (it casts shapes to ints). Same maths, plain ops.
class PlainMHA(torch.nn.Module):
    def __init__(self, mha):
        super().__init__()
        E = mha.embed_dim; self.h = mha.num_heads; self.d = E // self.h; self.E = E
        W, b = mha.in_proj_weight.detach(), mha.in_proj_bias.detach()
        self.q = torch.nn.Linear(E, E); self.k = torch.nn.Linear(E, E); self.v = torch.nn.Linear(E, E)
        for lin, i in ((self.q, 0), (self.k, 1), (self.v, 2)):
            lin.weight.data = W[i*E:(i+1)*E].clone(); lin.bias.data = b[i*E:(i+1)*E].clone()
        self.o = mha.out_proj
    def forward(self, query, key, value, *args, **kwargs):
        Q = self.q(query).reshape(1, -1, self.h, self.d).transpose(1, 2)
        K = self.k(key).reshape(1, -1, self.h, self.d).transpose(1, 2)
        V = self.v(value).reshape(1, -1, self.h, self.d).transpose(1, 2)
        a = torch.softmax((Q @ K.transpose(-1, -2)) * (self.d ** -0.5), dim=-1)
        out = (a @ V).transpose(1, 2).reshape(1, -1, self.E)
        return (self.o(out), None)

with torch.no_grad():
    test = torch.rand(1, 3, 224, 224) * 2 - 1
    before = model.get_image_features(pixel_values=test)
    before = before.pooler_output if hasattr(before, "pooler_output") else before
    model.vision_model.head.attention = PlainMHA(model.vision_model.head.attention)
    after = model.get_image_features(pixel_values=test)
    after = after.pooler_output if hasattr(after, "pooler_output") else after
    print("replacement changes the output by at most", float((before - after).abs().max()))

class ImageEncoder(torch.nn.Module):
    def __init__(self, m): super().__init__(); self.m = m
    def forward(self, pixel_values):
        f = self.m.get_image_features(pixel_values=pixel_values)
        f = f.pooler_output if hasattr(f, "pooler_output") else f
        return f / f.norm(dim=-1, keepdim=True)

enc = ImageEncoder(model).eval()
example = torch.rand(1, 3, 224, 224) * 2 - 1
with torch.no_grad():
    traced = torch.jit.trace(enc, example)
mlmodel = ct.convert(
    traced,
    inputs=[ct.ImageType(name="image", shape=(1, 3, 224, 224), scale=2/255.0, bias=[-1, -1, -1], color_layout=ct.colorlayout.RGB)],
    outputs=[ct.TensorType(name="embedding")],
    compute_precision=ct.precision.FLOAT16,
    minimum_deployment_target=ct.target.iOS17,
)
mlmodel.short_description = "SigLIP 2 base/16 image encoder (Google, Apache-2.0). Normalized 768-d embedding."
mlmodel.save("ml/SigLIPImage.mlpackage")

# Same answer as the original? Compare on the test photos.
imgs = ["gps/citytech1.jpg", "gps/cafe1.jpg", "gps/park1.jpg", "docs/dentist.png"]
for p in imgs:
    im = Image.open(p).convert("RGB")
    pv = proc(images=im, return_tensors="pt")["pixel_values"]
    with torch.no_grad(): ref = enc(pv)[0].numpy()
    out = mlmodel.predict({"image": im.resize((224, 224), Image.BICUBIC)})["embedding"][0]
    cos = float(np.dot(ref, out) / (np.linalg.norm(ref) * np.linalg.norm(out)))
    print(f"{p:22s} cosine(original, Core ML) = {cos:.4f}")
json.dump({"logit_scale": float(model.logit_scale.exp()), "logit_bias": float(model.logit_bias)}, open("ml/calibration.json", "w"))
print("calibration:", open("ml/calibration.json").read())
