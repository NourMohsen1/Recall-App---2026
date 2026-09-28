import ExpoModulesCore
import PDFKit
import UIKit
import Vision

// Reads the words in a screenshot, a photo of a document, or a PDF — on the
// phone, with Apple's own Vision text recognition (the engine behind Live
// Text) and PDFKit. The file itself never leaves the device; the app only
// ever sends on the words, exactly as if the user had typed them.
public class TextReaderModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TextReader")

    AsyncFunction("readImage") { (uri: String) throws -> [String: Any] in
      guard let url = Self.fileURL(uri), let image = UIImage(contentsOfFile: url.path),
        let cg = image.cgImage
      else {
        throw Exception(name: "ERR_TEXT_READER_IMAGE", description: "Could not open the image at \(uri)")
      }
      let lines = try Self.recognize(cg, orientation: Self.orientation(image.imageOrientation))
      return ["text": lines.joined(separator: "\n"), "pages": 1, "scannedPages": 1]
    }

    // A PDF usually has real text in it, which is read directly and exactly.
    // A scanned PDF is only pictures of text: those pages are drawn and read
    // like a screenshot. `previewPath` is page one as an image, so the app
    // can show the document without a PDF viewer.
    AsyncFunction("readPdf") { (uri: String, maxPages: Int, previewPath: String) throws -> [String: Any] in
      guard let url = Self.fileURL(uri), let doc = PDFDocument(url: url) else {
        throw Exception(name: "ERR_TEXT_READER_PDF", description: "Could not open the PDF at \(uri)")
      }
      var parts: [String] = []
      var scanned = 0
      let count = min(doc.pageCount, max(1, maxPages))
      for i in 0..<count {
        guard let page = doc.page(at: i) else { continue }
        let text = page.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if text.count >= 20 {
          parts.append(text)
          continue
        }
        if let cg = Self.render(page, scale: 2).cgImage {
          parts.append(try Self.recognize(cg, orientation: .up).joined(separator: "\n"))
          scanned += 1
        }
      }

      var preview: String? = nil
      if !previewPath.isEmpty, let first = doc.page(at: 0),
        let data = Self.render(first, scale: 1.5).jpegData(compressionQuality: 0.8),
        let target = Self.fileURL(previewPath)
      {
        try data.write(to: target)
        preview = target.absoluteString
      }

      var result: [String: Any] = [
        "text": parts.joined(separator: "\n\n"),
        "pages": doc.pageCount,
        "scannedPages": scanned,
      ]
      if let preview = preview { result["previewUri"] = preview }
      return result
    }
  }

  static func fileURL(_ uri: String) -> URL? {
    if uri.hasPrefix("file://") { return URL(string: uri) }
    return URL(fileURLWithPath: uri)
  }

  static func render(_ page: PDFPage, scale: CGFloat) -> UIImage {
    let bounds = page.bounds(for: .mediaBox)
    return page.thumbnail(of: CGSize(width: bounds.width * scale, height: bounds.height * scale), for: .mediaBox)
  }

  static func recognize(_ image: CGImage, orientation: CGImagePropertyOrientation) throws -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    // Nour's documents are English and Arabic, often mixed.
    request.automaticallyDetectsLanguage = true
    if let supported = try? request.supportedRecognitionLanguages() {
      let wanted = ["en-US", "ar-SA"].filter { supported.contains($0) }
      if !wanted.isEmpty { request.recognitionLanguages = wanted }
    }
    let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
    try handler.perform([request])
    let observations = request.results ?? []

    // Vision measures from the bottom-left. Read top to bottom, and left to
    // right within a line, so "Date:" stays next to its date.
    let sorted = observations.sorted { a, b in
      let ay = a.boundingBox.midY
      let by = b.boundingBox.midY
      if abs(ay - by) > min(a.boundingBox.height, b.boundingBox.height) / 2 { return ay > by }
      return a.boundingBox.minX < b.boundingBox.minX
    }
    var lines: [String] = []
    var current: [String] = []
    var lastY: CGFloat? = nil
    var lastHeight: CGFloat = 0
    for o in sorted {
      guard let text = o.topCandidates(1).first?.string else { continue }
      let y = o.boundingBox.midY
      if let ly = lastY, abs(ly - y) <= min(lastHeight, o.boundingBox.height) / 2 {
        current.append(text)
      } else {
        if !current.isEmpty { lines.append(current.joined(separator: "  ")) }
        current = [text]
      }
      lastY = y
      lastHeight = o.boundingBox.height
    }
    if !current.isEmpty { lines.append(current.joined(separator: "  ")) }
    return lines
  }

  static func orientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    case .upMirrored: return .upMirrored
    case .downMirrored: return .downMirrored
    case .leftMirrored: return .leftMirrored
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}
