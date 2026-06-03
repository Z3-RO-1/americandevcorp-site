import SwiftUI

@main
struct AuthorityConnectApp: App {
    @StateObject private var store = SubmissionStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
