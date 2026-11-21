// Run from apps/mobile: swift scripts/generate-ios-app-icons.swift
// Compose the existing 0hi mascot over native vector backgrounds. No redraw of
// the brand mark, generated artwork, or runtime image dependency is needed.
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let source = root.appendingPathComponent("app/features/login/mascot.png")
guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
      let mascot = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else { fatalError("Missing 0hi mascot") }
let catalog = root.appendingPathComponent("ios/Notesnook/Images.xcassets")
let previews = root.appendingPathComponent("app/assets/images/app-icons")
try FileManager.default.createDirectory(at: previews, withIntermediateDirectories: true)
let variants = [("black", "OhaiIconBlack"), ("cream", "OhaiIconCream"), ("purple", "OhaiIconPurple")]
// Same trimmed mascot and neon outline as Roku-Client/build-artwork.mjs.
let rokuSource = root.appendingPathComponent("scripts/assets/roku-ghost.png")
guard let rokuImageSource = CGImageSourceCreateWithURL(rokuSource as CFURL, nil),
      let rokuMascot = CGImageSourceCreateImageAtIndex(rokuImageSource, 0, nil) else { fatalError("Missing Roku mascot") }

func render(_ variant: String, size: Int) throws -> Data {
    let space = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fatalError("Image context failed") }
    let rect = CGRect(x: 0, y: 0, width: size, height: size)
    context.interpolationQuality = .high
    if variant == "purple" {
        let colors: [CGFloat] = [84/255, 44/255, 131/255, 1, 40/255, 19/255, 63/255, 1, 13/255, 6/255, 24/255, 1]
        let gradient = CGGradient(colorSpace: space, colorComponents: colors, locations: [0, 0.55, 1], count: 3)!
        let center = CGPoint(x: CGFloat(size) * 0.5, y: CGFloat(size) * 0.55)
        context.drawRadialGradient(gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: CGFloat(size) * 0.7, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    } else {
        let rgb: [CGFloat] = variant == "black" ? [0.055, 0.055, 0.06, 1] : [0.965, 0.94, 0.88, 1]
        context.setFillColor(CGColor(colorSpace: space, components: rgb)!)
        context.fill(rect)
    }
    if variant == "purple" {
        let scale = CGFloat(size) * 0.82 / CGFloat(max(rokuMascot.width, rokuMascot.height))
        let width = CGFloat(rokuMascot.width) * scale
        let height = CGFloat(rokuMascot.height) * scale
        context.draw(rokuMascot, in: CGRect(x: (CGFloat(size) - width) / 2, y: (CGFloat(size) - height) / 2, width: width, height: height))
    } else {
        context.draw(mascot, in: rect)
    }
    guard let image = context.makeImage() else { fatalError("Image render failed") }
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil) else { fatalError("PNG destination failed") }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("PNG encoding failed") }
    return data as Data
}

for (variant, name) in variants {
    let directory = catalog.appendingPathComponent(name + ".appiconset")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    // Modern universal iOS icons let actool generate every device size from
    // the full-resolution master, including iPad and iOS 26 icon rendering.
    let filename = name + "-1024.png"
    for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) {
        if file.pathExtension == "png" { try FileManager.default.removeItem(at: file) }
    }
    try render(variant, size: 1024).write(to: directory.appendingPathComponent(filename))
    let images: [[String: Any]] = [["filename": filename, "idiom": "universal", "platform": "ios", "size": "1024x1024"]]
    let contents: [String: Any] = ["images": images, "info": ["author": "0hi", "version": 1]]
    try JSONSerialization.data(withJSONObject: contents, options: [.prettyPrinted, .sortedKeys]).write(to: directory.appendingPathComponent("Contents.json"))
    try render(variant, size: 188).write(to: previews.appendingPathComponent(variant + ".png"))
    print("Generated \(name)")
}
