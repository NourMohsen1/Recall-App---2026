# Private-photo model

`convert.py` builds `modules/photo-guard/ios/models/PrivatePhoto.mlmodelc`
from Marqo/nsfw-image-detection-384 (Apache-2.0, ViT-tiny, 5.6 M params):
convert, then `xcrun coremlc compile PrivatePhoto.mlpackage <dir>`.

Measured (Sept 2026): Core ML output matches PyTorch within a few points;
on 60 random everyday photos from COCO val2017 the median score was 0.06,
and at the 0.35 cutoff one was skipped (a bathroom photo, 0.365), none at
0.5. The model's own evaluation puts 0.35 at ~98.5% of private photos
caught and ~2.5% of ordinary ones skipped — strict by choice.
