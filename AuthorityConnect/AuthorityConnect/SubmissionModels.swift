import Foundation

struct SubmissionWorksheet: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var name: String = "Untitled App"
    var bundleID: String = ""
    var status: String = "Prepare for Submission"
    var values: [String: String] = [:]
    var imported: [String: Bool] = [:]
    var history: [WorksheetSnapshot] = []
    var createdAt: Date = Date()
    var updatedAt: Date = Date()
}

struct WorksheetSnapshot: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var createdAt: Date = Date()
    var reason: String
    var values: [String: String]
    var imported: [String: Bool]
}

struct SubmissionField: Identifiable, Hashable {
    let id: String
    let title: String
    var required: Bool = false
    var isShared: Bool = false
    var placeholder: String = ""
    var kind: FieldKind = .text
}

enum FieldKind: Hashable {
    case text
    case longText
    case dateTime
    case file
    case choice([String])
    case checkbox
    case mediaAssets
}

struct SubmissionSection: Identifiable {
    let id: String
    let title: String
    var subtitle: String = ""
    let fields: [SubmissionField]
    var children: [SubmissionSection] = []
}

extension SubmissionSection {
    var allFields: [SubmissionField] {
        fields + children.flatMap(\.allFields)
    }
}
