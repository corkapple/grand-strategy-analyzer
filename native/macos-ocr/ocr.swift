// On-device text reader for macOS, built on Apple's Vision framework. Prints one row of text per line,
// cells in a row separated by " | ". No network access. Usage: gsa-ocr <image file> [scale]
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write(Data("usage: gsa-ocr <image> [scale]\n".utf8))
    exit(2)
}
let scale = args.count >= 3 ? (Double(args[2]) ?? 1.0) : 1.0

guard let img = NSImage(contentsOfFile: args[1]),
      var cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    FileHandle.standardError.write(Data("cannot read image\n".utf8))
    exit(1)
}

// A second pass at another size gives an independent reading to compare against.
if scale != 1.0 {
    let w = Int(Double(cg.width) * scale), h = Int(Double(cg.height) * scale)
    if let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                           space: CGColorSpaceCreateDeviceRGB(),
                           bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        if let scaled = ctx.makeImage() { cg = scaled }
    }
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false  // these are numbers and fixed labels; "correcting" them hurts
do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
    FileHandle.standardError.write(Data("recognition failed: \(error)\n".utf8))
    exit(1)
}

let observations = (request.results ?? []).sorted { a, b in
    if abs(a.boundingBox.midY - b.boundingBox.midY) > 0.012 { return a.boundingBox.midY > b.boundingBox.midY }
    return a.boundingBox.minX < b.boundingBox.minX
}
var lastY: CGFloat = -1
var line = ""
for o in observations {
    guard let t = o.topCandidates(1).first else { continue }
    if lastY >= 0 && abs(o.boundingBox.midY - lastY) > 0.012 {
        print(line)
        line = ""
    }
    line += (line.isEmpty ? "" : "  |  ") + t.string
    lastY = o.boundingBox.midY
}
print(line)
