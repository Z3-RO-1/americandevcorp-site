import SwiftUI

@main
struct AppSubmissionPrepApp: App {
    @StateObject private var store = SubmissionStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
    }
}
