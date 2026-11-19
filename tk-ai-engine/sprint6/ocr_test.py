"""
Sprint 6 — Apple Vision framework OCR POC. macOS'un native metin tanıma
motorunu (VNRecognizeTextRequest) kullanır — ekstra model indirmeye
gerek yok, cihazda çalışır, ücretsiz. ChatGPT'nin önerisindeki "OCR
katmanı" fikrinin yerel/ücretsiz karşılığı.

Usage: uv run python sprint6/ocr_test.py <path-to-image>
"""

import sys

import Quartz
import Vision
from Foundation import NSURL


def recognize_text(image_path):
    url = NSURL.fileURLWithPath_(image_path)
    image_source = Quartz.CGImageSourceCreateWithURL(url, None)
    cg_image = Quartz.CGImageSourceCreateImageAtIndex(image_source, 0, None)

    results = []

    def handler(request, error):
        if error:
            print("OCR error:", error)
            return
        for observation in request.results():
            candidates = observation.topCandidates_(1)
            if candidates:
                top = candidates[0]
                results.append((top.string(), top.confidence()))

    request = Vision.VNRecognizeTextRequest.alloc().initWithCompletionHandler_(handler)
    request.setRecognitionLevel_(1)  # accurate (0 = fast, 1 = accurate)
    request.setUsesLanguageCorrection_(False)

    handler_obj = Vision.VNImageRequestHandler.alloc().initWithCGImage_options_(cg_image, {})
    handler_obj.performRequests_error_([request], None)

    return results


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python sprint6/ocr_test.py <path-to-image>")
        sys.exit(1)

    results = recognize_text(sys.argv[1])
    if not results:
        print("(metin bulunamadı)")
    for text, confidence in results:
        print(f"  [{confidence:.2f}] {text}")
