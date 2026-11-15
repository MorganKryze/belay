// A mark on the weight chart, ported from the shared rules.

/// Optional text, 80 UTF-16 units at most as the web counts them, on one line.
public func isAnnotationLabel(_ label: String?) -> Bool {
  guard let label else { return true }
  return label.utf16.count <= Bounds.annotationLabelMax
    && !label.unicodeScalars.contains { $0 == "\n" || $0 == "\r" }
}
