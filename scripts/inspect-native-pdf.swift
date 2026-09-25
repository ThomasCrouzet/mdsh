import AppKit
import PDFKit

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

// Check the PDF from the product print operation, including its rendered pixels.
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
    let page = document.page(at: index)!
    let bounds = page.bounds(for: .mediaBox)
    guard abs(bounds.width - 595.28) < 1, abs(bounds.height - 841.89) < 1 else {
        fail("Expected A4 pages")
    }
    let thumbnail = page.thumbnail(of: NSSize(width: 595, height: 842), for: .mediaBox)
    let bitmap = NSBitmapImageRep(data: thumbnail.tiffRepresentation!)!
    var red = 0
    var blue = 0
    for y in 0..<bitmap.pixelsHigh {
        for x in 0..<bitmap.pixelsWide {
            guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
            if color.redComponent > 0.8 && color.greenComponent < 0.2 && color.blueComponent < 0.2 { red += 1 }
            if color.blueComponent > 0.8 && color.greenComponent < 0.2 && color.redComponent < 0.2 { blue += 1 }
        }
    }
    if red > 50 && blue > 50 { completeImage = true }
    let png = bitmap.representation(using: .png, properties: [:])!
    try png.write(to: output.appendingPathComponent("native-page-\(index + 1).png"))
    pages.append(["page": index + 1, "width": bounds.width, "height": bounds.height, "redPixels": red, "bluePixels": blue])
}
guard completeImage else { fail("The top and bottom image bands must stay on the same page") }
let evidence: [String: Any] = ["pages": pages, "finalParagraph": true, "completeImage": completeImage]
let json = try JSONSerialization.data(withJSONObject: evidence, options: [.prettyPrinted, .sortedKeys])
try json.write(to: output.appendingPathComponent("native-pdf-inspection.json"))
print("Verified \(document.pageCount) A4 pages and complete image borders")
