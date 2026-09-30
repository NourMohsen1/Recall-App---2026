import CoreML
import ExpoModulesCore
import Photos
import SensitiveContentAnalysis
import UIKit
import Vision

// Two quiet jobs, both entirely on the phone:
//
//   · Is this photo private (nudity)? Checked BEFORE a photo enters Recall,
//     so a private photo is never stored, shown, read for faces or sent to
//     an AI service. Uses a small open model (Marqo nsfw-image-detection-384,
//     Apache-2.0) always, plus Apple's own detector when the user has
//     Sensitive Content Warning switched on. Neither result leaves the phone.
//   · Which of these library photos still exist? So a photo deleted from
//     Photos disappears from Recall too.
public class PhotoGuardModule: Module {
  private var model: VNCoreMLModel?

  public func definition() -> ModuleDefinition {
    Name("PhotoGuard")

    // Library photos, by Photos id. The score is the model's P(nudity).
    AsyncFunction("checkAssets") { (ids: [String]) throws -> [[String: Any]] in
      var out: [[String: Any]] = []
      for id in ids {
        guard let image = Self.preview(assetId: id) else {
          out.append(["id": id, "missing": true])
          continue
        }
        out.append(["id": id, "score": try self.score(image), "apple": Self.appleFlags(image)])
      }
      return out
    }

    // A file the user picked by hand (Add Photos, a place's cover…).
    AsyncFunction("checkFile") { (uri: String) throws -> [String: Any] in
      let url = uri.hasPrefix("file://") ? URL(string: uri)! : URL(fileURLWithPath: uri)
      guard let ui = UIImage(contentsOfFile: url.path), let image = ui.cgImage else {
        throw Exception(name: "ERR_IMAGE", description: "Could not open \(uri)")
      }
      return ["score": try self.score(image), "apple": Self.appleFlags(image)]
    }

    // "full", "limited" or "none". With limited access most of the library
    // is invisible, which must never read as "those photos were deleted".
    Function("libraryAccess") { () -> String in
      switch PHPhotoLibrary.authorizationStatus(for: .readWrite) {
      case .authorized: return "full"
      case .limited: return "limited"
      default: return "none"
      }
    }

    // Local ids are per device: a phone restored from a backup, or a new
    // phone with iCloud Photos, gives the same photos new ones. Cloud ids
    // survive that. These two map between them.
    AsyncFunction("cloudIds") { (ids: [String]) -> [String: String] in
      guard #available(iOS 15.0, *) else { return [:] }
      var out: [String: String] = [:]
      let mappings = PHPhotoLibrary.shared().cloudIdentifierMappings(forLocalIdentifiers: ids)
      for (local, result) in mappings {
        if case .success(let cloud) = result { out[local] = cloud.stringValue }
      }
      return out
    }

    AsyncFunction("localIdsForCloudIds") { (cloud: [String]) -> [String: String] in
      guard #available(iOS 15.0, *) else { return [:] }
      var out: [String: String] = [:]
      let ids = cloud.map { PHCloudIdentifier(stringValue: $0) }
      let mappings = PHPhotoLibrary.shared().localIdentifierMappings(for: ids)
      for (cloudId, result) in mappings {
        if case .success(let local) = result { out[cloudId.stringValue] = local }
      }
      return out
    }

    // The ids that still exist in the Photos library. Photos in "Recently
    // Deleted" are not returned, so they count as deleted.
    AsyncFunction("existingAssets") { (ids: [String]) -> [String] in
      var found = Set<String>()
      let batch = 400
      var i = 0
      while i < ids.count {
        let slice = Array(ids[i..<min(i + batch, ids.count)])
        // Hidden photos are left out of a fetch unless asked for — and a
        // hidden photo is not a deleted one.
        let options = PHFetchOptions()
        options.includeHiddenAssets = true
        PHAsset.fetchAssets(withLocalIdentifiers: slice, options: options).enumerateObjects { asset, _, _ in
          found.insert(asset.localIdentifier)
        }
        i += batch
      }
      return ids.filter { found.contains($0) }
    }
  }

  private func loadModel() throws -> VNCoreMLModel {
    if let model = model { return model }
    guard
      let bundleURL = Bundle(for: PhotoGuardModule.self).url(forResource: "PhotoGuardModels", withExtension: "bundle"),
      let bundle = Bundle(url: bundleURL),
      let url = bundle.url(forResource: "PrivatePhoto", withExtension: "mlmodelc")
    else {
      throw Exception(name: "ERR_MODEL", description: "The private-photo model is missing from this build.")
    }
    let config = MLModelConfiguration()
    #if targetEnvironment(simulator)
      config.computeUnits = .cpuOnly
    #else
      config.computeUnits = .all
    #endif
    let loaded = try VNCoreMLModel(for: MLModel(contentsOf: url, configuration: config))
    model = loaded
    return loaded
  }

  private func score(_ image: CGImage) throws -> Double {
    let request = VNCoreMLRequest(model: try loadModel())
    // The model was trained on whole images squashed to a square.
    request.imageCropAndScaleOption = .scaleFill
    #if targetEnvironment(simulator)
      if #available(iOS 17.0, *),
        let cpu = MLComputeDevice.allComputeDevices.first(where: { if case .cpu = $0 { return true } else { return false } })
      {
        request.setComputeDevice(cpu, for: .main)
      }
    #endif
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    guard
      let obs = request.results?.first as? VNCoreMLFeatureValueObservation,
      let probs = obs.featureValue.multiArrayValue, probs.count >= 1
    else {
      throw Exception(name: "ERR_MODEL_OUTPUT", description: "The private-photo model returned nothing.")
    }
    return probs[0].doubleValue  // [P(NSFW), P(SFW)]
  }

  // Apple's detector, only when the user has it switched on in Settings —
  // otherwise its policy is "disabled" and it cannot be asked.
  static func appleFlags(_ image: CGImage) -> Bool {
    guard #available(iOS 17.0, *) else { return false }
    let analyzer = SCSensitivityAnalyzer()
    if analyzer.analysisPolicy == .disabled { return false }
    var flagged = false
    let done = DispatchSemaphore(value: 0)
    Task.detached {
      if let result = try? await analyzer.analyzeImage(image) { flagged = result.isSensitive }
      done.signal()
    }
    _ = done.wait(timeout: .now() + 5)
    return flagged
  }

  // A small local preview. Never downloads from iCloud: a photo whose
  // original is only in the cloud still has a local preview to check.
  static func preview(assetId: String) -> CGImage? {
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [assetId], options: nil).firstObject else {
      return nil
    }
    let options = PHImageRequestOptions()
    options.isSynchronous = true
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    options.isNetworkAccessAllowed = false
    var result: CGImage?
    PHImageManager.default().requestImage(
      for: asset, targetSize: CGSize(width: 384, height: 384), contentMode: .aspectFit, options: options
    ) { image, _ in result = image?.cgImage }
    return result
  }
}
