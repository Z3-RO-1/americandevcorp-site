import Foundation
import SwiftUI

@MainActor
final class SubmissionStore: ObservableObject {
    @Published var worksheets: [SubmissionWorksheet] = []
    @Published var sharedProfile: [String: String] = [:]

    private let fileURL: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        fileURL = documents.appendingPathComponent("authority-connect-worksheets.json")
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        decoder.dateDecodingStrategy = .iso8601
        load()
    }

    func load() {
        guard let data = try? Data(contentsOf: fileURL) else {
            worksheets = [Self.newWorksheet(sharedProfile: sharedProfile)]
            save()
            return
        }

        do {
            if let archive = try? decoder.decode(WorksheetArchive.self, from: data) {
                sharedProfile = archive.sharedProfile
                worksheets = archive.worksheets.map { Self.applySharedProfile(sharedProfile, to: $0) }
            } else {
                worksheets = try decoder.decode([SubmissionWorksheet].self, from: data)
                sharedProfile = Self.extractSharedProfile(from: worksheets)
                worksheets = worksheets.map { Self.applySharedProfile(sharedProfile, to: $0) }
            }
            if worksheets.isEmpty {
                worksheets = [Self.newWorksheet(sharedProfile: sharedProfile)]
                save()
            }
        } catch {
            worksheets = [Self.newWorksheet(sharedProfile: sharedProfile)]
        }
    }

    func save() {
        let archive = WorksheetArchive(sharedProfile: sharedProfile, worksheets: worksheets)
        guard let data = try? encoder.encode(archive) else { return }
        try? data.write(to: fileURL, options: [.atomic])
    }

    func createWorksheet() -> SubmissionWorksheet {
        let worksheet = Self.newWorksheet(sharedProfile: sharedProfile)
        worksheets.insert(worksheet, at: 0)
        save()
        return worksheet
    }

    func update(_ worksheet: SubmissionWorksheet, reason: String = "Autosave") {
        var copy = worksheet
        copy.updatedAt = Date()
        copy.name = copy.values["name"].flatMap { $0.isEmpty ? nil : $0 } ?? copy.name
        copy.bundleID = copy.values["bundleID"] ?? copy.bundleID

        if copy.history.last?.values != copy.values || copy.history.last?.imported != copy.imported {
            copy.history.append(WorksheetSnapshot(reason: reason, values: copy.values, imported: copy.imported))
        }

        if let index = worksheets.firstIndex(where: { $0.id == copy.id }) {
            worksheets[index] = copy
        } else {
            worksheets.insert(copy, at: 0)
        }
        save()
    }

    func updateSharedValue(fieldID: String, value: String, sourceWorksheetID: SubmissionWorksheet.ID? = nil) {
        guard SubmissionSchema.sharedFieldIDs.contains(fieldID) else { return }
        sharedProfile[fieldID] = value

        for index in worksheets.indices {
            worksheets[index].values[fieldID] = value
            worksheets[index].updatedAt = Date()
            if sourceWorksheetID == nil || worksheets[index].id != sourceWorksheetID {
                worksheets[index].imported[fieldID] = false
            }
        }
        save()
    }

    func delete(_ worksheet: SubmissionWorksheet) {
        worksheets.removeAll { $0.id == worksheet.id }
        save()
    }

    func rename(_ worksheet: SubmissionWorksheet, to name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let index = worksheets.firstIndex(where: { $0.id == worksheet.id }) else { return }
        worksheets[index].name = trimmed
        worksheets[index].values["name"] = trimmed
        worksheets[index].updatedAt = Date()
        worksheets[index].history.append(WorksheetSnapshot(reason: "Renamed", values: worksheets[index].values, imported: worksheets[index].imported))
        save()
    }

    func duplicate(_ worksheet: SubmissionWorksheet) -> SubmissionWorksheet {
        var copy = worksheet
        copy.id = UUID()
        copy.name = "\(worksheet.name) Copy"
        copy.values["name"] = copy.name
        copy.createdAt = Date()
        copy.updatedAt = Date()
        copy.history.append(WorksheetSnapshot(reason: "Duplicated", values: copy.values, imported: copy.imported))
        worksheets.insert(copy, at: 0)
        save()
        return copy
    }

    func exportText(for worksheet: SubmissionWorksheet) -> String {
        var lines: [String] = [
            "Authority Connect Worksheet",
            "App: \(worksheet.name)",
            "Bundle ID: \(worksheet.bundleID.isEmpty ? "Not entered" : worksheet.bundleID)",
            "Updated: \(worksheet.updatedAt.formatted(date: .abbreviated, time: .shortened))",
            ""
        ]

        for section in SubmissionSchema.sections {
            append(section, worksheet: worksheet, level: 0, to: &lines)
        }

        return lines.joined(separator: "\n")
    }

    private func append(_ section: SubmissionSection, worksheet: SubmissionWorksheet, level: Int, to lines: inout [String]) {
        let prefix = String(repeating: "#", count: min(level + 2, 6))
        lines.append("\(prefix) \(section.title)")

        for field in section.fields {
            let value = worksheet.values[field.id, default: ""]
            let imported = worksheet.imported[field.id] == true ? " [imported]" : ""
            lines.append("- \(field.title)\(imported): \(value.isEmpty ? "Not entered" : value)")
        }

        if !section.fields.isEmpty {
            lines.append("")
        }

        for child in section.children {
            append(child, worksheet: worksheet, level: level + 1, to: &lines)
        }
    }

    func replace(_ worksheet: SubmissionWorksheet, with snapshot: WorksheetSnapshot) -> SubmissionWorksheet {
        var copy = worksheet
        copy.values = snapshot.values
        copy.imported = snapshot.imported
        copy.updatedAt = Date()
        copy.history.append(WorksheetSnapshot(reason: "Restored version", values: copy.values, imported: copy.imported))
        update(copy, reason: "Restored version")
        return copy
    }

    static func newWorksheet(sharedProfile: [String: String] = [:]) -> SubmissionWorksheet {
        var worksheet = SubmissionWorksheet()
        worksheet.values["status"] = "Prepare for Submission"
        worksheet.values["releaseChoice"] = "Manually release this version"
        worksheet.values["contentRights"] = "Owns or has rights"
        worksheet.values["licenseAgreement"] = "Standard Apple License Agreement"
        worksheet.values["distributionMethod"] = "Public - Discoverable by anyone on the App Store"
        worksheet = applySharedProfile(sharedProfile, to: worksheet)
        worksheet.history = [WorksheetSnapshot(reason: "Created", values: worksheet.values, imported: worksheet.imported)]
        return worksheet
    }

    private static func extractSharedProfile(from worksheets: [SubmissionWorksheet]) -> [String: String] {
        var profile: [String: String] = [:]
        for worksheet in worksheets {
            for fieldID in SubmissionSchema.sharedFieldIDs {
                if profile[fieldID, default: ""].isEmpty, let value = worksheet.values[fieldID], !value.isEmpty {
                    profile[fieldID] = value
                }
            }
        }
        return profile
    }

    private static func applySharedProfile(_ sharedProfile: [String: String], to worksheet: SubmissionWorksheet) -> SubmissionWorksheet {
        var copy = worksheet
        for fieldID in SubmissionSchema.sharedFieldIDs {
            if let value = sharedProfile[fieldID], !value.isEmpty {
                copy.values[fieldID] = value
            }
        }
        return copy
    }
}

private struct WorksheetArchive: Codable {
    var sharedProfile: [String: String]
    var worksheets: [SubmissionWorksheet]
}
