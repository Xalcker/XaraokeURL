// AppDelegate para recibir el device token de APNs (Fase 5). En una app SwiftUI se engancha con
// @UIApplicationDelegateAdaptor en XaraokeApp. El token se lo pasa a PushRegistration, que lo manda
// al servidor.

import Foundation
#if canImport(UIKit)
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in PushRegistration.shared.didReceive(tokenData: deviceToken) }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        Task { @MainActor in PushRegistration.shared.didFail(error) }
    }
}
#endif
