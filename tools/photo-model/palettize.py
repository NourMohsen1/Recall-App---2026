import coremltools as ct, coremltools.optimize.coreml as cto, numpy as np
from PIL import Image
m16 = ct.models.MLModel("ml/SigLIPImage.mlpackage")
cfg = cto.OptimizationConfig(global_config=cto.OpPalettizerConfig(mode="kmeans", nbits=8, granularity="per_tensor"))
m8 = cto.palettize_weights(m16, config=cfg)
m8.save("ml/SigLIPImageP8.mlpackage")
for p in ["gps/citytech1.jpg", "gps/cafe1.jpg", "gps/park1.jpg", "docs/dentist.png"]:
    im = Image.open(p).convert("RGB").resize((224, 224), Image.BILINEAR)
    a = m16.predict({"image": im})["embedding"][0]; b = m8.predict({"image": im})["embedding"][0]
    print(f"{p:22s} palettized vs 16-bit cosine = {float(np.dot(a,b)/(np.linalg.norm(a)*np.linalg.norm(b))):.4f}")
