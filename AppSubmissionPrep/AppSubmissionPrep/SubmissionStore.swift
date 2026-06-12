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
        fileURL = documents.appendingPathComponent("app-submission-prep-worksheets.json")
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

            scrubSeededPersonalContent()
        } catch {
            worksheets = [Self.newWorksheet(sharedProfile: sharedProfile)]
            save()
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

    func refreshAISourceContext(for worksheet: SubmissionWorksheet) -> SubmissionWorksheet {
        var copy = worksheet
        copy.values["aiImportNotes"] = "No local build profile is registered for this worksheet yet. Add a public repository URL and run AI Import, or fill the build/source fields manually."
        update(copy, reason: "AI source context refresh")
        return copy
    }

    func importFromGitHub(repoURL: String, branch: String, into worksheet: SubmissionWorksheet) async throws -> SubmissionWorksheet {
        let result = try await GitHubAIImportService.importWorksheetValues(repoURL: repoURL, branch: branch)
        var copy = worksheet

        for (fieldID, value) in result.values where !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            copy.values[fieldID] = value
            copy.imported[fieldID] = true
        }

        copy.values["aiName"] = "Codex AI Import"
        copy.values["repoURL"] = result.repositoryURL
        copy.values["repoBranch"] = result.branch
        copy.values["repoImportSummary"] = result.summary
        copy.values["repoImportProvenance"] = result.provenance
        copy.values["aiImportNotes"] = result.notes

        for fieldID in ["aiName", "repoURL", "repoBranch", "repoImportSummary", "repoImportProvenance", "aiImportNotes"] {
            copy.imported[fieldID] = true
        }

        copy.name = copy.values["name"].flatMap { $0.isEmpty ? nil : $0 } ?? copy.name
        copy.bundleID = copy.values["bundleID"] ?? copy.bundleID
        update(copy, reason: "GitHub repo AI import")
        return copy
    }

    func exportText(for worksheet: SubmissionWorksheet) -> String {
        var lines: [String] = [
            "App Submission Prep Worksheet",
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

    func exportLongFormHTMLFile(for worksheet: SubmissionWorksheet) throws -> URL {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let exportDirectory = documents.appendingPathComponent("AppSubmissionPrepExports", isDirectory: true)
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)

        let fileName = "\(safeFileName(worksheet.name))-app-store-long-form.html"
        let fileURL = exportDirectory.appendingPathComponent(fileName)
        try exportLongFormHTML(for: worksheet).write(to: fileURL, atomically: true, encoding: .utf8)
        return fileURL
    }

    func exportLongFormHTML(for worksheet: SubmissionWorksheet) -> String {
        var body = """
        <header>
          <p class="eyebrow">App Submission Prep</p>
          <h1>\(htmlEscaped(worksheet.name))</h1>
          <p class="meta">Bundle ID: \(htmlEscaped(worksheet.bundleID))</p>
          <p class="meta">Updated: \(htmlEscaped(worksheet.updatedAt.formatted(date: .abbreviated, time: .shortened)))</p>
        </header>
        """

        for section in SubmissionSchema.sections {
            body += html(for: section, worksheet: worksheet, level: 1)
        }

        return """
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>\(htmlEscaped(worksheet.name)) App Store Submission Long Form</title>
          <style>
            :root {
              color-scheme: light;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              color: #111;
              background: #f5f5f7;
            }
            body {
              margin: 0;
              padding: 32px;
              background: #f5f5f7;
            }
            main {
              max-width: 980px;
              margin: 0 auto;
              background: #fff;
              border: 1px solid #dedee3;
              border-radius: 16px;
              padding: 32px;
              box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
            }
            header {
              border-bottom: 2px solid #111;
              padding-bottom: 18px;
              margin-bottom: 28px;
            }
            .eyebrow {
              margin: 0 0 8px;
              text-transform: uppercase;
              letter-spacing: 0.08em;
              font-size: 12px;
              font-weight: 700;
              color: #666;
            }
            h1 {
              margin: 0 0 8px;
              font-size: 36px;
              line-height: 1.05;
            }
            h2 {
              margin: 30px 0 12px;
              padding-bottom: 8px;
              border-bottom: 1px solid #d6d6dc;
              font-size: 22px;
            }
            h3 {
              margin: 22px 0 10px;
              font-size: 17px;
            }
            .meta {
              margin: 4px 0;
              color: #555;
              font-size: 14px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 10px 0 16px;
              table-layout: fixed;
            }
            th, td {
              border: 1px solid #dedee3;
              padding: 10px 12px;
              vertical-align: top;
              text-align: left;
              font-size: 14px;
              line-height: 1.35;
              white-space: pre-wrap;
              word-break: break-word;
            }
            th {
              width: 30%;
              background: #f2f2f4;
              font-weight: 700;
            }
            .required {
              color: #9b1c1c;
              font-size: 12px;
              font-weight: 700;
              margin-left: 4px;
            }
            .blank {
              min-height: 18px;
              display: block;
            }
            @media print {
              body {
                background: #fff;
                padding: 0;
              }
              main {
                box-shadow: none;
                border: 0;
                border-radius: 0;
              }
            }
          </style>
        </head>
        <body>
          <main>
            \(body)
          </main>
        </body>
        </html>
        """
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

    private func html(for section: SubmissionSection, worksheet: SubmissionWorksheet, level: Int) -> String {
        var html = ""
        let heading = min(level + 1, 3)
        html += "<h\(heading)>\(htmlEscaped(section.title))</h\(heading)>"

        if !section.subtitle.isEmpty {
            html += "<p class=\"meta\">\(htmlEscaped(section.subtitle))</p>"
        }

        if !section.fields.isEmpty {
            html += "<table>"
            for field in section.fields {
                let value = worksheet.values[field.id, default: ""]
                let required = field.required ? "<span class=\"required\">required</span>" : ""
                let displayValue = value.isEmpty ? "<span class=\"blank\">&nbsp;</span>" : htmlEscaped(value)
                html += "<tr><th>\(htmlEscaped(field.title)) \(required)</th><td>\(displayValue)</td></tr>"
            }
            html += "</table>"
        }

        for child in section.children {
            html += self.html(for: child, worksheet: worksheet, level: level + 1)
        }

        return html
    }

    private func htmlEscaped(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
            .replacingOccurrences(of: "'", with: "&#39;")
    }

    private func safeFileName(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let cleaned = String(value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "-")
            .lowercased()
        return cleaned.isEmpty ? "app-store-submission" : cleaned
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

    private func scrubSeededPersonalContent() {
        let personalSharedFields = [
            "developerAccountHolder",
            "developerTeamID",
            "appStoreAccessRole",
            "contactFirstName",
            "contactLastName",
            "contactEmail",
            "contactPhone",
            "copyright"
        ]

        let originalWorksheets = worksheets
        worksheets.removeAll { worksheet in
            let hasSeedHistory = worksheet.history.contains { $0.reason.localizedCaseInsensitiveContains("Seeded") }
            let hasLocalMachinePath = worksheet.values.values.contains { $0.localizedCaseInsensitiveContains("/Users/") }
            let hasPreloadedSourceNotes = worksheet.values["repoImportSummary", default: ""].isEmpty == false
                || worksheet.values["repoImportProvenance", default: ""].isEmpty == false
                || worksheet.values["aiImportNotes", default: ""].localizedCaseInsensitiveContains("populated")
            return hasSeedHistory || hasLocalMachinePath || hasPreloadedSourceNotes
        }

        for fieldID in personalSharedFields {
            sharedProfile[fieldID] = ""
        }

        if worksheets.isEmpty {
            worksheets = [Self.newWorksheet(sharedProfile: sharedProfile)]
        }

        if worksheets != originalWorksheets {
            save()
        }
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

private enum GitHubAIImportService {
    static func importWorksheetValues(repoURL: String, branch requestedBranch: String) async throws -> RepoImportResult {
        let repo = try GitHubRepositoryLocation(repoURL)
        let repository = try await fetchJSON(GitHubRepository.self, from: repo.apiURL)
        let branch = requestedBranch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? repository.defaultBranch : requestedBranch.trimmingCharacters(in: .whitespacesAndNewlines)
        let treeURL = URL(string: "https://api.github.com/repos/\(repo.owner)/\(repo.name)/git/trees/\(branch.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? branch)?recursive=1")!
        let tree = try await fetchJSON(GitHubTree.self, from: treeURL)
        let filePaths = tree.tree.filter { $0.type == "blob" }.map(\.path)

        var values: [String: String] = [:]
        var sources: [String] = []

        values["repoURL"] = repo.canonicalURL
        values["repoBranch"] = branch

        let xcodeProjectPath = filePaths.first { $0.hasSuffix(".xcodeproj/project.pbxproj") }
        if let xcodeProjectPath {
            values["buildProjectPath"] = "\(repo.canonicalURL)/tree/\(branch)/\(xcodeProjectPath)"
            values["buildScheme"] = xcodeProjectPath.components(separatedBy: ".xcodeproj/").first?.components(separatedBy: "/").last ?? ""
            sources.append("Found Xcode project metadata in \(xcodeProjectPath).")

            if let pbxproj = try? await fetchRawText(repo: repo, branch: branch, path: xcodeProjectPath) {
                let buildSettings = parsePBXProj(pbxproj)
                mergeBuildValue(buildSettings["INFOPLIST_KEY_CFBundleDisplayName"], into: "name", values: &values)
                mergeBuildValue(buildSettings["PRODUCT_NAME"], into: "buildDisplayName", values: &values)
                mergeBuildValue(buildSettings["PRODUCT_BUNDLE_IDENTIFIER"], into: "bundleID", values: &values)
                mergeBuildValue(buildSettings["PRODUCT_BUNDLE_IDENTIFIER"], into: "buildBundleID", values: &values)
                mergeBuildValue(buildSettings["MARKETING_VERSION"], into: "version", values: &values)
                mergeBuildValue(buildSettings["MARKETING_VERSION"], into: "buildVersion", values: &values)
                mergeBuildValue(buildSettings["CURRENT_PROJECT_VERSION"], into: "buildNumber", values: &values)
            }
        }

        let infoPlistPaths = filePaths.filter { $0.hasSuffix("Info.plist") || $0.localizedCaseInsensitiveContains("Info.plist") }.prefix(5)
        for path in infoPlistPaths {
            guard let data = try? await fetchRawData(repo: repo, branch: branch, path: path),
                  let plist = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil) as? [String: Any] else { continue }

            mergeBuildValue(plist["CFBundleDisplayName"] as? String, into: "name", values: &values)
            mergeBuildValue(plist["CFBundleName"] as? String, into: "buildDisplayName", values: &values)
            mergeBuildValue(plist["CFBundleIdentifier"] as? String, into: "bundleID", values: &values)
            mergeBuildValue(plist["CFBundleIdentifier"] as? String, into: "buildBundleID", values: &values)
            mergeBuildValue(plist["CFBundleShortVersionString"] as? String, into: "version", values: &values)
            mergeBuildValue(plist["CFBundleShortVersionString"] as? String, into: "buildVersion", values: &values)
            mergeBuildValue(plist["CFBundleVersion"] as? String, into: "buildNumber", values: &values)
            sources.append("Read Info.plist values from \(path).")
        }

        if values["name", default: ""].isEmpty {
            values["name"] = repository.name.replacingOccurrences(of: "-", with: " ").capitalized
        }
        if values["sku", default: ""].isEmpty {
            values["sku"] = safeSKU(values["name"] ?? repository.name)
        }
        if values["buildDisplayName", default: ""].isEmpty, let name = values["name"], !name.isEmpty {
            values["buildDisplayName"] = name
        }

        let cnamePath = filePaths.first { $0.components(separatedBy: "/").last?.caseInsensitiveCompare("CNAME") == .orderedSame }
        var publicDomain: String?
        if let cnamePath,
           let domain = try? await fetchRawText(repo: repo, branch: branch, path: cnamePath)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: "\n")
            .first
            .map(String.init) {
            publicDomain = domain
        }

        let readablePaths = priorityTextPaths(from: filePaths)
        var textCorpus: [(path: String, text: String)] = []
        for path in readablePaths.prefix(12) {
            if let text = try? await fetchRawText(repo: repo, branch: branch, path: path), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                textCorpus.append((path, text))
            }
        }

        if let readme = textCorpus.first(where: { $0.path.lowercased().hasSuffix("readme.md") }) {
            let summary = markdownSummary(readme.text)
            if !summary.isEmpty {
                values["description"] = summary
                sources.append("Drafted description from \(readme.path).")
            }
        }

        if let domain = publicDomain, !domain.isEmpty {
            if let privacyPath = filePaths.first(where: { $0.lowercased().contains("privacy") && ($0.hasSuffix(".html") || $0.hasSuffix(".md")) }) {
                values["privacyPolicyURL"] = "https://\(domain)/\(privacyPath)"
                sources.append("Inferred privacy policy URL from CNAME and \(privacyPath).")
            }
            if let supportPath = filePaths.first(where: { $0.lowercased().contains("support") && ($0.hasSuffix(".html") || $0.hasSuffix(".md")) }) {
                values["supportURL"] = "https://\(domain)/\(supportPath)"
                sources.append("Inferred support URL from CNAME and \(supportPath).")
            }
            if let appPagePath = filePaths.first(where: { $0.lowercased().contains("app") && $0.hasSuffix(".html") }) {
                values["marketingURL"] = "https://\(domain)/\(appPagePath)"
                sources.append("Inferred marketing URL from CNAME and \(appPagePath).")
            }
        }

        for item in textCorpus {
            let urls = extractURLs(from: item.text)
            if values["privacyPolicyURL", default: ""].isEmpty, let url = urls.first(where: { $0.lowercased().contains("privacy") }) {
                values["privacyPolicyURL"] = url
                sources.append("Found privacy URL in \(item.path).")
            }
            if values["supportURL", default: ""].isEmpty, let url = urls.first(where: { $0.lowercased().contains("support") || $0.lowercased().contains("contact") }) {
                values["supportURL"] = url
                sources.append("Found support URL in \(item.path).")
            }
            if values["marketingURL", default: ""].isEmpty, let url = urls.first(where: { !$0.lowercased().contains("github.com") }) {
                values["marketingURL"] = url
                sources.append("Found marketing URL in \(item.path).")
            }
        }

        if values["keywords", default: ""].isEmpty {
            values["keywords"] = keywordGuess(from: values["name"] ?? repository.name, textCorpus: textCorpus.map(\.text).joined(separator: "\n"))
        }

        values["buildConfiguration"] = "Imported from GitHub source metadata. Confirm the exact archive/build in Xcode before copying into App Store Connect."

        let importedFields = values.keys.sorted()
        let provenance = sources.isEmpty
            ? "No direct source files were strong enough to cite. The importer only kept safe repository metadata."
            : sources.joined(separator: "\n")
        let summary = """
        Scanned \(repo.owner)/\(repo.name) on branch \(branch).
        Imported \(importedFields.count) worksheet fields: \(importedFields.joined(separator: ", ")).
        Review every imported value before copying it into App Store Connect.
        """
        let notes = """
        Codex AI Import inspected the public GitHub repository and populated fields only from source files or conservative metadata inference.

        This import does not access App Store Connect, does not submit anything, and should be treated as a draft for human review.

        \(provenance)
        """

        return RepoImportResult(
            repositoryURL: repo.canonicalURL,
            branch: branch,
            values: values,
            summary: summary,
            provenance: provenance,
            notes: notes
        )
    }

    private static func fetchJSON<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
        var request = URLRequest(url: url)
        request.setValue("AppSubmissionPrep/1.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
            throw RepoImportError.network("GitHub returned an error for \(url.absoluteString).")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func fetchRawText(repo: GitHubRepositoryLocation, branch: String, path: String) async throws -> String {
        let data = try await fetchRawData(repo: repo, branch: branch, path: path)
        return String(decoding: data, as: UTF8.self)
    }

    private static func fetchRawData(repo: GitHubRepositoryLocation, branch: String, path: String) async throws -> Data {
        let encodedBranch = branch.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? branch
        let encodedPath = path.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
        let url = URL(string: "https://raw.githubusercontent.com/\(repo.owner)/\(repo.name)/\(encodedBranch)/\(encodedPath)")!
        var request = URLRequest(url: url)
        request.setValue("AppSubmissionPrep/1.0", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse, 200..<300 ~= httpResponse.statusCode else {
            throw RepoImportError.network("Could not read \(path).")
        }
        return data
    }

    private static func parsePBXProj(_ text: String) -> [String: String] {
        var values: [String: String] = [:]
        for key in ["INFOPLIST_KEY_CFBundleDisplayName", "PRODUCT_NAME", "PRODUCT_BUNDLE_IDENTIFIER", "MARKETING_VERSION", "CURRENT_PROJECT_VERSION"] {
            if let value = firstRegexMatch(in: text, pattern: "\(key)\\s*=\\s*([^;]+);") {
                values[key] = cleanBuildSettingValue(value)
            }
        }
        return values
    }

    private static func firstRegexMatch(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range), match.numberOfRanges > 1,
              let swiftRange = Range(match.range(at: 1), in: text) else { return nil }
        return String(text[swiftRange])
    }

    private static func cleanBuildSettingValue(_ value: String) -> String {
        let cleaned = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        if cleaned.hasPrefix("$(") || cleaned == "$(inherited)" {
            return ""
        }
        return cleaned
    }

    private static func mergeBuildValue(_ value: String?, into fieldID: String, values: inout [String: String]) {
        guard let value else { return }
        let cleaned = cleanBuildSettingValue(value)
        guard !cleaned.isEmpty, values[fieldID, default: ""].isEmpty else { return }
        values[fieldID] = cleaned
    }

    private static func priorityTextPaths(from paths: [String]) -> [String] {
        let readableExtensions = [".md", ".txt", ".html", ".json", ".plist", ".xcprivacy"]
        return paths
            .filter { path in
                let lower = path.lowercased()
                return readableExtensions.contains(where: lower.hasSuffix)
                    && !lower.contains("node_modules/")
                    && !lower.contains("deriveddata/")
                    && !lower.contains(".build/")
            }
            .sorted { lhs, rhs in
                score(lhs) > score(rhs)
            }
    }

    private static func score(_ path: String) -> Int {
        let lower = path.lowercased()
        var score = 0
        if lower.hasSuffix("readme.md") { score += 100 }
        if lower.contains("privacy") { score += 70 }
        if lower.contains("support") { score += 60 }
        if lower.contains("app") { score += 40 }
        if lower.contains("marketing") { score += 35 }
        if lower.contains("store") { score += 20 }
        return score
    }

    private static func markdownSummary(_ markdown: String) -> String {
        let lines = markdown
            .components(separatedBy: .newlines)
            .filter { line in
                let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
                return !trimmed.isEmpty
                    && !trimmed.hasPrefix("#")
                    && !trimmed.hasPrefix("!")
                    && !trimmed.hasPrefix("[!")
                    && !trimmed.hasPrefix("<")
            }

        return lines
            .prefix(4)
            .joined(separator: "\n\n")
            .replacingOccurrences(of: "**", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func extractURLs(from text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"https?://[^\s\)\]\"<]+"#) else { return [] }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return regex.matches(in: text, range: range).compactMap { match in
            Range(match.range, in: text).map { String(text[$0]).trimmingCharacters(in: CharacterSet(charactersIn: ".,;")) }
        }
    }

    private static func keywordGuess(from name: String, textCorpus: String) -> String {
        let text = "\(name) \(textCorpus)".lowercased()
        let candidates = [
            "business", "productivity", "shopping", "marketplace", "directory", "vendors", "storefronts",
            "utilities", "education", "developer tools", "local business", "forms", "submission", "app store"
        ]
        let matches = candidates.filter { text.contains($0) }
        return Array(matches.prefix(8)).joined(separator: ",")
    }

    private static func safeSKU(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-"))
        let base = value
            .lowercased()
            .replacingOccurrences(of: " ", with: "-")
        let cleaned = String(base.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
            .replacingOccurrences(of: "--", with: "-")
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return "\(cleaned.isEmpty ? "app" : cleaned)-ios-001"
    }
}

private struct RepoImportResult {
    var repositoryURL: String
    var branch: String
    var values: [String: String]
    var summary: String
    var provenance: String
    var notes: String
}

private struct GitHubRepositoryLocation {
    let owner: String
    let name: String

    init(_ value: String) throws {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("git@github.com:") {
            let path = trimmed.replacingOccurrences(of: "git@github.com:", with: "").replacingOccurrences(of: ".git", with: "")
            let parts = path.split(separator: "/").map(String.init)
            guard parts.count >= 2 else { throw RepoImportError.invalidURL }
            owner = parts[0]
            name = parts[1]
            return
        }

        guard let url = URL(string: trimmed), url.host?.lowercased().contains("github.com") == true else {
            throw RepoImportError.invalidURL
        }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard parts.count >= 2 else { throw RepoImportError.invalidURL }
        owner = parts[0]
        name = parts[1].replacingOccurrences(of: ".git", with: "")
    }

    var canonicalURL: String {
        "https://github.com/\(owner)/\(name)"
    }

    var apiURL: URL {
        URL(string: "https://api.github.com/repos/\(owner)/\(name)")!
    }
}

private struct GitHubRepository: Decodable {
    let name: String
    let defaultBranch: String

    enum CodingKeys: String, CodingKey {
        case name
        case defaultBranch = "default_branch"
    }
}

private struct GitHubTree: Decodable {
    let tree: [GitHubTreeItem]
}

private struct GitHubTreeItem: Decodable {
    let path: String
    let type: String
}

private enum RepoImportError: LocalizedError {
    case invalidURL
    case network(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Enter a GitHub repository URL like https://github.com/owner/repo."
        case .network(let message):
            return message
        }
    }
}

private struct WorksheetArchive: Codable {
    var sharedProfile: [String: String]
    var worksheets: [SubmissionWorksheet]
}
