import CoreML
import ExpoModulesCore
import Photos
import UIKit
import Vision

// Understands a photo on the phone. For one library photo, by its Photos id:
//
//   · Apple Vision's own scene labels ("beach", "food", "document"…), built
//     into iOS — no model to ship, nothing to license.
//   · A SigLIP 2 image embedding (Google, Apache-2.0), run on the Neural
//     Engine: 768 numbers that describe what the photo means, comparable
//     with words (see assets/models/siglip-vocab.json) and with other photos.
//
// The photo is fetched through PhotoKit by its asset id — never through a
// file path, which stops being readable when the app restarts — as a small
// preview, which is all either model looks at. Nothing leaves the device.
public class PhotoUnderstandingModule: Module {
  private var clip: VNCoreMLModel?
  private var clipError: String?

  public func definition() -> ModuleDefinition {
    Name("PhotoUnderstanding")

    // Loads the model once; returns how long that took, or why it failed.
    AsyncFunction("prepare") { () -> [String: Any] in
      let started = Date()
      _ = try self.loadClip()
      return ["ms": Date().timeIntervalSince(started) * 1000]
    }

    AsyncFunction("analyze") { (assetId: String) throws -> [String: Any] in
      let t0 = Date()
      guard let image = try Self.preview(assetId: assetId, side: 448) else {
        throw Exception(name: "ERR_PHOTO_UNAVAILABLE", description: "No preview for asset \(assetId)")
      }
      let t1 = Date()

      let labels = try Self.visionLabels(image)
      let t2 = Date()

      let embedding = try self.embed(image)
      let t3 = Date()

      return [
        "labels": labels,
        "embedding": embedding,
        "ms": [
          "fetch": t1.timeIntervalSince(t0) * 1000,
          "vision": t2.timeIntervalSince(t1) * 1000,
          "clip": t3.timeIntervalSince(t2) * 1000,
        ],
      ]
    }
  }

  private func loadClip() throws -> VNCoreMLModel {
    if let clip = clip { return clip }
    if let clipError = clipError {
      throw Exception(name: "ERR_MODEL", description: clipError)
    }
    guard
      let bundleURL = Bundle(for: PhotoUnderstandingModule.self)
        .url(forResource: "PhotoUnderstandingModels", withExtension: "bundle"),
      let bundle = Bundle(url: bundleURL),
      let modelURL = bundle.url(forResource: "SigLIPImage8bit", withExtension: "mlmodelc")
    else {
      clipError = "The photo model is missing from this build."
      throw Exception(name: "ERR_MODEL", description: clipError!)
    }
    let config = MLModelConfiguration()
    #if targetEnvironment(simulator)
      config.computeUnits = .cpuOnly  // the simulator has no Neural Engine
    #else
      config.computeUnits = .all  // the Neural Engine when it can
    #endif
    let model = try VNCoreMLModel(for: MLModel(contentsOf: modelURL, configuration: config))
    clip = model
    return model
  }

  private func embed(_ image: CGImage) throws -> [Float] {
    let request = VNCoreMLRequest(model: try loadClip())
    // SigLIP was trained on whole images squashed to a square, not cropped.
    request.imageCropAndScaleOption = .scaleFill
    Self.cpuOnSimulator(request)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    guard
      let obs = request.results?.first as? VNCoreMLFeatureValueObservation,
      let array = obs.featureValue.multiArrayValue
    else {
      throw Exception(name: "ERR_MODEL_OUTPUT", description: "The photo model returned nothing.")
    }
    var out = [Float](repeating: 0, count: array.count)
    for i in 0..<array.count { out[i] = array[i].floatValue }
    return out
  }

  // Vision's built-in classifier. Only labels it is reasonably sure of, most
  // sure first — its taxonomy has over a thousand, most near zero.
  static func visionLabels(_ image: CGImage) throws -> [[String: Any]] {
    let request = VNClassifyImageRequest()
    cpuOnSimulator(request)
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    return (request.results ?? [])
      .filter { $0.confidence >= 0.25 }
      .sorted { $0.confidence > $1.confidence }
      .prefix(10)
      .map { ["id": $0.identifier, "confidence": Double($0.confidence)] }
  }

  // Vision's models fail on the simulator ("Failed to create espresso
  // context") unless told to use the CPU. A real phone uses the Neural Engine.
  static func cpuOnSimulator(_ request: VNRequest) {
    #if targetEnvironment(simulator)
      if #available(iOS 17.0, *) {
        let cpu = MLComputeDevice.allComputeDevices.first { device in
          if case .cpu = device { return true }
          return false
        }
        if let cpu = cpu { request.setComputeDevice(cpu, for: .main) }
      } else {
        request.usesCPUOnly = true
      }
    #endif
  }

  // A small preview of a library photo. Local copies only: a bulk pass must
  // never pull originals down from iCloud (see src/photoImport.ts). iOS keeps
  // a small local version of almost every photo, which is all this needs.
  static func preview(assetId: String, side: CGFloat) throws -> CGImage? {
    let id = assetId.components(separatedBy: "/").first ?? assetId
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetId, id], options: nil).firstObject else {
      return nil
    }
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    options.isNetworkAccessAllowed = false
    var result: CGImage?
    PHImageManager.default().requestImage(
      for: asset,
      targetSize: CGSize(width: side, height: side),
      contentMode: .aspectFit,
      options: options
    ) { image, _ in
      result = image?.cgImage
    }
    return result
  }
}
