import AppKit
import PDFKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// Check the PDF from the product print operation, including its rendered pixels.
let started = ProcessInfo.processInfo.systemUptime
let budgetSeconds = 20.0
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
guard let document = PDFDocument(url: source), document.pageCount >= 3 else {
    fail("Expected a readable multipage PDF")
}
let text = document.string ?? ""
try text.write(to: output.appendingPathComponent("native-extracted.txt"), atomically: true, encoding: .utf8)
// PDFKit can place underscore glyphs after the word they underline.
let compactText = text.components(separatedBy: .whitespacesAndNewlines).joined().replacingOccurrences(of: "_", with: "")
guard compactText.contains("NATIVEPDFEND"), !text.contains("Exporter en PDF") else {
    fail("The PDF must contain the final paragraph and exclude the editor")
}
var pages: [[String: Any]] = []
var completeImage = false
for index in 0..<document.pageCount {
    let pageStarted = ProcessInfo.processInfo.systemUptime
    let page = document.page(at: index)!
    let bounds = page.bounds(for: .mediaBox)
    guard abs(bounds.width - 595.28) < 1, abs(bounds.height - 841.89) < 1 else {
        fail("Expected A4 pages")
    }
    // Render once into a fixed RGBA buffer. Avoid an AppKit allocation per pixel.
    let width = 595
    let height = 842
    let stride = width * 4
    var pixels = [UInt8](repeating: 255, count: stride * height)
    var red = 0
    var blue = 0
    let png: Data = pixels.withUnsafeMutableBytes { bytes in
        guard let context = CGContext(data: bytes.baseAddress, width: width, height: height,
            bitsPerComponent: 8, bytesPerRow: stride, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else {
            fail("Cannot allocate the page bitmap")
        }
        context.setFillColor(CGColor(gray: 1, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.scaleBy(x: CGFloat(width) / bounds.width, y: CGFloat(height) / bounds.height)
        page.draw(with: .mediaBox, to: context)
        for offset in Swift.stride(from: 0, to: bytes.count, by: 4) {
            if bytes[offset] > 204 && bytes[offset + 1] < 51 && bytes[offset + 2] < 51 { red += 1 }
            if bytes[offset + 2] > 204 && bytes[offset + 1] < 51 && bytes[offset] < 51 { blue += 1 }
        }
        guard let image = context.makeImage(),
            let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
            fail("Cannot encode the page bitmap")
        }
        return data
    }
    if red > 50 && blue > 50 { completeImage = true }
    try png.write(to: output.appendingPathComponent("native-page-\(index + 1).png"))
    pages.append(["page": index + 1, "width": bounds.width, "height": bounds.height, "redPixels": red, "bluePixels": blue,
        "inspectionSeconds": ProcessInfo.processInfo.systemUptime - pageStarted])
}
guard completeImage else { fail("The top and bottom image bands must stay on the same page") }
let elapsed = ProcessInfo.processInfo.systemUptime - started
let evidence: [String: Any] = ["pages": pages, "finalParagraph": true, "completeImage": completeImage,
    "inspectionSeconds": elapsed, "budgetSeconds": budgetSeconds, "withinBudget": elapsed <= budgetSeconds,
    "bitmap": ["width": 595, "height": 842, "format": "RGBA8"]]
let json = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
try json.write(to: output.appendingPathComponent("native-pdf-inspection.json"))
guard elapsed <= budgetSeconds else { fail("PDF inspection exceeded its 20 second budget") }
print("Verified \(document.pageCount) A4 pages and complete image borders")
