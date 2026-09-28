// Lector de QR con Vision (DataScannerViewController), envuelto para SwiftUI.
// Equivalente a scanQrCode de android/.../ui/PlayServices.kt.
//
// Diferencia con Android: el lector de Play Services usa su propia cámara sin permiso; en iOS la
// cámara siempre pide permiso (Info.plist: NSCameraUsageDescription). Requiere dispositivo real:
// el Simulator no tiene cámara.

import SwiftUI
import VisionKit

enum ScanResult {
    case text(String)
    case cancelled
    case unavailable
}

struct QRScannerSheet: View {
    let onResult: (ScanResult) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                ZStack(alignment: .topTrailing) {
                    DataScannerRepresentable { value in
                        finish(.text(value))
                    }
                    .ignoresSafeArea()
                    Button {
                        finish(.cancelled)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white)
                            .padding()
                    }
                    .accessibilityLabel(L("back"))
                }
            } else {
                // Sin cámara (Simulator) o no soportado: se avisa y se cierra.
                Color.black.ignoresSafeArea()
                    .onAppear { finish(.unavailable) }
            }
        }
    }

    private func finish(_ result: ScanResult) {
        onResult(result)
        dismiss()
    }
}

private struct DataScannerRepresentable: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
        try? scanner.startScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onFound: onFound) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onFound: (String) -> Void
        private var done = false
        init(onFound: @escaping (String) -> Void) { self.onFound = onFound }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            handle(addedItems)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            handle([item])
        }

        private func handle(_ items: [RecognizedItem]) {
            guard !done else { return }
            for item in items {
                if case let .barcode(barcode) = item, let value = barcode.payloadStringValue {
                    done = true
                    onFound(value)
                    return
                }
            }
        }
    }
}
