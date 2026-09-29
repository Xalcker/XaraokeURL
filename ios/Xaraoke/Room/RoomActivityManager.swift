// Arranca, actualiza y termina la Live Activity de la sala. Lo usa Notifications (RoomNotifying).
// Fase 5. Con la app en primer plano la actividad se actualiza desde aquí; en segundo plano, el
// servidor la actualiza por push usar el token de la actividad (pushTokenUpdates), que se registra
// junto con el device token.

import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
@MainActor
final class RoomActivityManager {
    static let shared = RoomActivityManager()

    private var activity: Activity<RoomActivityAttributes>?
    private var currentRoom: String?

    // Deriva el estado de la Live Activity desde el RoomState.
    private func contentState(from state: RoomState) -> RoomActivityAttributes.ContentState {
        let unknown = L("unknown_artist")
        let nowPlaying: String = state.head.map {
            let d = songDisplay($0.song, title: $0.title, unknownArtist: unknown)
            return L("now_playing", d.artist, d.title)
        } ?? L("queue_empty")
        return RoomActivityAttributes.ContentState(
            nowPlaying: nowPlaying,
            paused: state.paused,
            songsAhead: songsBeforeMyTurn(state.queue, me: state.myName),
            hostConnected: state.hostConnected
        )
    }

    func start(_ state: RoomState) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        // Si ya hay una de otra sala, se termina antes.
        if currentRoom != nil && currentRoom != state.roomCode { end() }
        if activity != nil { update(state); return }
        let attributes = RoomActivityAttributes(roomCode: state.roomCode)
        let content = contentState(from: state)
        do {
            if #available(iOS 16.2, *) {
                activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: content, staleDate: nil),
                    pushType: .token
                )
            } else {
                activity = try Activity.request(attributes: attributes, contentState: content, pushType: .token)
            }
            currentRoom = state.roomCode
            observePushToken()
        } catch {
            activity = nil
        }
    }

    func update(_ state: RoomState) {
        guard let activity = activity else { return }
        let content = contentState(from: state)
        Task {
            if #available(iOS 16.2, *) {
                await activity.update(.init(state: content, staleDate: nil))
            } else {
                await activity.update(using: content)
            }
        }
    }

    func end() {
        guard let activity = activity else { return }
        self.activity = nil
        currentRoom = nil
        Task {
            if #available(iOS 16.2, *) {
                await activity.end(nil, dismissalPolicy: .immediate)
            } else {
                await activity.end(dismissalPolicy: .immediate)
            }
        }
    }

    // El token de push de la actividad se manda al servidor para que la actualice en segundo plano.
    private func observePushToken() {
        guard let activity = activity else { return }
        Task {
            for await tokenData in activity.pushTokenUpdates {
                let token = tokenData.map { String(format: "%02x", $0) }.joined()
                await PushRegistration.shared.reportActivityToken(token, room: activity.attributes.roomCode)
            }
        }
    }
}
#endif
