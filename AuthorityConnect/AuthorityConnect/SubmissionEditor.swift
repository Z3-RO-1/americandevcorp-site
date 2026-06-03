import SwiftUI

struct SubmissionEditor: View {
    @EnvironmentObject private var store: SubmissionStore
    @State private var worksheet: SubmissionWorksheet
    @State private var isEditing = true
    @State private var historyIndex: Int?
    @State private var showRejectionAssistant = false

    init(worksheet: SubmissionWorksheet) {
        _worksheet = State(initialValue: worksheet)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                header
                readinessPanel

                ForEach(SubmissionSchema.sections) { section in
                    SubmissionSectionView(section: section, worksheet: $worksheet, level: 0, isEditing: isEditing)
                }
            }
            .padding(.vertical, 18)
            .padding(.horizontal, 14)
            .frame(maxWidth: 1120, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(worksheet.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    showRejectionAssistant = true
                } label: {
                    Label("Rejection", systemImage: "exclamationmark.bubble")
                }

                Button {
                    moveHistory(-1)
                } label: {
                    Image(systemName: "chevron.left")
                }
                .disabled(!canMoveHistory(-1))

                Button {
                    moveHistory(1)
                } label: {
                    Image(systemName: "chevron.right")
                }
                .disabled(!canMoveHistory(1))

                if let historyIndex, worksheet.history.indices.contains(historyIndex), historyIndex < worksheet.history.count - 1 {
                    Button("Replace") {
                        worksheet = store.replace(worksheet, with: worksheet.history[historyIndex])
                        self.historyIndex = worksheet.history.count - 1
                    }
                }

                Toggle("Edit", isOn: $isEditing)
                    .toggleStyle(.switch)
            }
        }
        .onChange(of: worksheet.values) {
            normalizeWorksheet()
        }
        .sheet(isPresented: $showRejectionAssistant) {
            RejectionAssistantView(worksheet: $worksheet)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Prepare for Submission")
                .font(.largeTitle.weight(.semibold))
                .lineLimit(2)
                .minimumScaleFactor(0.78)
            Text("Continuous submission worksheet modeled after the App Store Connect review flow.")
                .foregroundStyle(.secondary)

            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) {
                    headerStats
                }

                VStack(alignment: .leading, spacing: 6) {
                    headerStats
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var headerStats: some View {
        Label("\(Int(readiness * 100))% ready", systemImage: "checkmark.seal")
        Label("\(importedCount) of \(filledCount) imported", systemImage: "square.and.arrow.down")
        if let historyIndex {
            Label("Version \(historyIndex + 1) of \(worksheet.history.count)", systemImage: "clock.arrow.circlepath")
        } else {
            Label("Latest version", systemImage: "clock")
        }
    }

    private var readinessPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            ProgressView(value: readiness)
                .tint(Color(.systemGray))
            ProgressView(value: importProgress)
                .tint(.green)

            if !missingRequired.isEmpty {
                Text("\(missingRequired.count) required items still need values.")
                    .foregroundStyle(.orange)
            } else {
                Text("Required submission fields are filled.")
                    .foregroundStyle(.green)
            }
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var requiredFields: [SubmissionField] {
        SubmissionSchema.requiredFields
    }

    private var missingRequired: [SubmissionField] {
        requiredFields.filter { (worksheet.values[$0.id] ?? "").isEmpty }
    }

    private var readiness: Double {
        guard !requiredFields.isEmpty else { return 1 }
        return Double(requiredFields.count - missingRequired.count) / Double(requiredFields.count)
    }

    private var filledCount: Int {
        SubmissionSchema.allFields.filter { !(worksheet.values[$0.id] ?? "").isEmpty }.count
    }

    private var importedCount: Int {
        SubmissionSchema.allFields.filter { field in
            !(worksheet.values[field.id] ?? "").isEmpty && worksheet.imported[field.id] == true
        }.count
    }

    private var importProgress: Double {
        guard filledCount > 0 else { return 0 }
        return Double(importedCount) / Double(filledCount)
    }

    private func normalizeWorksheet() {
        worksheet.name = worksheet.values["name"].flatMap { $0.isEmpty ? nil : $0 } ?? "Untitled App"
        worksheet.bundleID = worksheet.values["bundleID"] ?? ""
        for field in SubmissionSchema.allFields {
            if worksheet.imported[field.id] == true && (worksheet.values[field.id] ?? "").isEmpty {
                worksheet.imported[field.id] = false
            }
        }
        store.update(worksheet)
    }

    private func canMoveHistory(_ offset: Int) -> Bool {
        let current = historyIndex ?? worksheet.history.count - 1
        return worksheet.history.indices.contains(current + offset)
    }

    private func moveHistory(_ offset: Int) {
        let current = historyIndex ?? worksheet.history.count - 1
        let next = current + offset
        guard worksheet.history.indices.contains(next) else { return }
        historyIndex = next
        worksheet.values = worksheet.history[next].values
        worksheet.imported = worksheet.history[next].imported
    }
}

private struct SubmissionSectionView: View {
    let section: SubmissionSection
    @Binding var worksheet: SubmissionWorksheet
    let level: Int
    let isEditing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(section.title)
                    .font(level == 0 ? .title2.weight(.semibold) : .headline)
                if !section.subtitle.isEmpty {
                    Text(section.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }

            ForEach(section.fields) { field in
                SubmissionFieldRow(field: field, worksheet: $worksheet, isEditing: isEditing)
            }

            ForEach(section.children) { child in
                SubmissionSectionView(section: child, worksheet: $worksheet, level: level + 1, isEditing: isEditing)
            }
        }
        .padding(sectionPadding)
        .background(sectionBackground, in: RoundedRectangle(cornerRadius: sectionRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: sectionRadius, style: .continuous)
                .stroke(Color(.separator).opacity(sectionStrokeOpacity))
        )
        .shadow(color: level == 0 ? Color.black.opacity(0.035) : Color.clear, radius: 10, y: 4)
    }

    private var sectionPadding: CGFloat {
        switch level {
        case 0: return 16
        case 1: return 12
        default: return 10
        }
    }

    private var sectionRadius: CGFloat {
        level == 0 ? 16 : 12
    }

    private var sectionStrokeOpacity: Double {
        switch level {
        case 0: return 0.38
        case 1: return 0.24
        default: return 0.16
        }
    }

    private var sectionBackground: Color {
        switch level {
        case 0: return Color(.secondarySystemGroupedBackground)
        case 1: return Color(.systemBackground)
        default: return Color(.tertiarySystemGroupedBackground)
        }
    }
}

private struct RejectionAssistantView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var worksheet: SubmissionWorksheet

    private var noticeBinding: Binding<String> {
        Binding {
            worksheet.values["appleRejectionNotice", default: ""]
        } set: { newValue in
            worksheet.values["appleRejectionNotice"] = newValue
        }
    }

    private var findings: [RejectionFinding] {
        RejectionAnalyzer.analyze(notice: worksheet.values["appleRejectionNotice"] ?? "", worksheet: worksheet)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Paste Apple’s rejection notice here. This stays local and is checked against the worksheet fields.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    TextEditor(text: noticeBinding)
                        .frame(minHeight: 170)
                        .textInputAutocapitalization(.sentences)
                } header: {
                    Text("Apple Rejection Notice")
                }

                Section("Local Findings") {
                    if findings.isEmpty {
                        ContentUnavailableView("No Notice Yet", systemImage: "doc.text.magnifyingglass", description: Text("Paste the rejection text to see targeted repair notes."))
                    } else {
                        ForEach(findings) { finding in
                            VStack(alignment: .leading, spacing: 8) {
                                Label(finding.title, systemImage: finding.priority.iconName)
                                    .font(.headline)
                                    .foregroundStyle(finding.priority.color)
                                Text(finding.detail)
                                    .font(.subheadline)
                                if !finding.fields.isEmpty {
                                    Text("Check: \(finding.fields.joined(separator: ", "))")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            .navigationTitle("Rejection Assistant")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct RejectionFinding: Identifiable {
    let id = UUID()
    let title: String
    let detail: String
    let fields: [String]
    let priority: RejectionPriority
}

private enum RejectionPriority {
    case high
    case medium
    case low

    var iconName: String {
        switch self {
        case .high: return "exclamationmark.triangle"
        case .medium: return "wrench.and.screwdriver"
        case .low: return "info.circle"
        }
    }

    var color: Color {
        switch self {
        case .high: return .orange
        case .medium: return .secondary
        case .low: return .secondary
        }
    }
}

private enum RejectionAnalyzer {
    static func analyze(notice: String, worksheet: SubmissionWorksheet) -> [RejectionFinding] {
        let text = notice.lowercased()
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }

        var findings: [RejectionFinding] = []
        let values = worksheet.values

        addIf(text, matches: ["privacy", "data collection", "tracking", "privacy policy"], to: &findings) {
            RejectionFinding(
                title: "Privacy metadata likely needs repair",
                detail: "Apple is pointing at privacy disclosure or tracking accuracy. Recheck the privacy policy URL, user privacy choices URL, tracking answer, data types collected, and any third-party SDK behavior.",
                fields: present(["Privacy Policy URL", "User Privacy Choices URL", "App Privacy", "Tracking", "Data types collected"]),
                priority: .high
            )
        }

        addIf(text, matches: ["login", "sign in", "sign-in", "demo account", "unable to access"], to: &findings) {
            RejectionFinding(
                title: "Reviewer access may be blocked",
                detail: "Apple likely could not enter the app or complete the review path. Confirm the demo username/password, reviewer notes, special flows, and any required setup instructions.",
                fields: present(["Username", "Password", "Notes", "Contact Information"]),
                priority: .high
            )
        }

        addIf(text, matches: ["screenshot", "preview", "metadata", "description", "keyword"], to: &findings) {
            RejectionFinding(
                title: "Store metadata may not match the app",
                detail: "Compare the app’s visible functionality against screenshots, previews, promotional text, description, and keywords. Apple often rejects when marketing text promises something the build does not clearly show.",
                fields: present(["Previews and Screenshots", "Promotional Text", "Description", "Keywords"]),
                priority: .medium
            )
        }

        addIf(text, matches: ["age rating", "kids", "children", "user-generated", "ugc", "web access"], to: &findings) {
            RejectionFinding(
                title: "Age rating or content controls need review",
                detail: "Recheck age rating notes, unrestricted web access, user-generated content, ads, moderation, and safety controls. The worksheet should describe the actual content and controls in plain language.",
                fields: present(["Age Rating Notes", "App Accessibility", "App Review Notes"]),
                priority: .medium
            )
        }

        addIf(text, matches: ["purchase", "subscription", "payment", "external purchase", "in-app purchase"], to: &findings) {
            RejectionFinding(
                title: "Monetization flow may conflict with review rules",
                detail: "Verify pricing, subscriptions, purchase paths, external payment language, and whether the app requires App Store in-app purchase support.",
                fields: present(["Pricing", "Availability", "Subscriptions", "App Distribution Methods"]),
                priority: .high
            )
        }

        addIf(text, matches: ["encryption", "export compliance", "cryptography"], to: &findings) {
            RejectionFinding(
                title: "Encryption documentation may be incomplete",
                detail: "Revisit the encryption notes and export compliance answer. If the app uses only standard Apple security or HTTPS, document that clearly.",
                fields: present(["App Encryption Documentation", "Encryption Notes"]),
                priority: .medium
            )
        }

        addIf(text, matches: ["guideline 2.1", "2.1"], to: &findings) {
            RejectionFinding(
                title: "Guideline 2.1 usually means review information or build completeness",
                detail: "Focus on demo access, broken flows, incomplete features, selected build, reviewer notes, and whether Apple can reproduce the intended app experience.",
                fields: present(["Sign-In Information", "Notes", "Build", "App Review Information"]),
                priority: .high
            )
        }

        addIf(text, matches: ["guideline 5.1", "5.1"], to: &findings) {
            RejectionFinding(
                title: "Guideline 5.1 usually points to privacy or data handling",
                detail: "Audit privacy disclosures, user consent, tracking, account/data deletion language, and third-party SDK data collection.",
                fields: present(["App Privacy", "Privacy Policy URL", "User Privacy Choices URL"]),
                priority: .high
            )
        }

        if (values["reviewNotes"] ?? "").isEmpty && text.contains("review") {
            findings.append(RejectionFinding(
                title: "Reviewer notes are empty",
                detail: "Add exact steps for Apple: how to sign in, what to tap first, what the reviewer should test, and anything that depends on timing, data, or a demo account.",
                fields: present(["Notes"]),
                priority: .medium
            ))
        }

        if findings.isEmpty {
            findings.append(RejectionFinding(
                title: "No strong local match found",
                detail: "Read the notice for the specific guideline number and paste any missing surrounding text. Start by checking required fields, reviewer access, privacy, screenshots, and metadata consistency.",
                fields: present(["Required fields", "App Review Information", "App Privacy"]),
                priority: .low
            ))
        }

        return findings
    }

    private static func addIf(_ text: String, matches: [String], to findings: inout [RejectionFinding], makeFinding: () -> RejectionFinding) {
        if matches.contains(where: { text.contains($0) }) {
            findings.append(makeFinding())
        }
    }

    private static func present(_ fields: [String]) -> [String] {
        fields
    }
}

private struct SubmissionFieldRow: View {
    @EnvironmentObject private var store: SubmissionStore
    @FocusState private var focusedLongTextField: String?
    let field: SubmissionField
    @Binding var worksheet: SubmissionWorksheet
    let isEditing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 10) {
                    fieldTitleBlock
                    Spacer(minLength: 12)
                    importedControl
                }

                VStack(alignment: .leading, spacing: 8) {
                    fieldTitleBlock
                    importedControl
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            input
                .disabled(!isEditing)
        }
        .padding(8)
        .background(field.isShared ? Color(.secondarySystemFill) : Color(.systemBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(field.isShared ? Color(.systemGray3).opacity(0.5) : Color(.separator).opacity(0.18))
        )
    }

    private var fieldTitleBlock: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(field.title)
                .font(.subheadline.weight(.medium))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            if field.required {
                Text("Required")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color(.tertiarySystemFill), in: Capsule())
                    .accessibilityLabel("Required field")
            }

            if field.isShared {
                Text("Account profile")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color(.systemBackground), in: Capsule())
                    .accessibilityLabel("Account profile field")
            }
        }
    }

    private var importedControl: some View {
        Toggle(isOn: importedBinding) {
            Text("Imported")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .toggleStyle(.button)
        .controlSize(.small)
        .disabled((worksheet.values[field.id] ?? "").isEmpty)
    }

    @ViewBuilder
    private var input: some View {
        switch field.kind {
        case .text, .file, .dateTime:
            TextField(field.placeholder, text: valueBinding)
                .textFieldStyle(.roundedBorder)
                .keyboardType(field.id == "contactPhone" ? .phonePad : .default)
                .submitLabel(.done)
        case .longText:
            TextEditor(text: valueBinding)
                .focused($focusedLongTextField, equals: field.id)
                .frame(minHeight: isLongTextFocused ? 132 : 54, maxHeight: isLongTextFocused ? 260 : 70)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(inputBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color(.separator).opacity(0.35)))
                .animation(.easeInOut(duration: 0.18), value: isLongTextFocused)
        case .choice(let choices):
            Picker(field.title, selection: valueBinding) {
                Text("Select").tag("")
                ForEach(choices, id: \.self) { choice in
                    Text(choice).tag(choice)
                }
            }
            .pickerStyle(.menu)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
            .padding(.horizontal, 10)
            .background(inputBackground, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color(.separator).opacity(0.35)))
        case .checkbox:
            Toggle(field.title, isOn: boolBinding)
                .toggleStyle(.switch)
                .padding(.vertical, 4)
                .labelsHidden()
        case .mediaAssets:
            MediaAssetsInput(field: field, worksheet: $worksheet, isEditing: isEditing)
        }
    }

    private var valueBinding: Binding<String> {
        Binding {
            formattedValue(worksheet.values[field.id, default: ""])
        } set: { newValue in
            let formattedValue = formattedValue(newValue)
            if worksheet.values[field.id] != formattedValue {
                worksheet.imported[field.id] = false
            }
            worksheet.values[field.id] = formattedValue
            if field.isShared {
                store.updateSharedValue(fieldID: field.id, value: formattedValue, sourceWorksheetID: worksheet.id)
            }
        }
    }

    private func formattedValue(_ value: String) -> String {
        field.id == "contactPhone" ? PhoneNumberFormatter.usDisplay(value) : value
    }

    private var boolBinding: Binding<Bool> {
        Binding {
            worksheet.values[field.id] == "true"
        } set: { newValue in
            worksheet.imported[field.id] = false
            worksheet.values[field.id] = newValue ? "true" : ""
            if field.isShared {
                store.updateSharedValue(fieldID: field.id, value: worksheet.values[field.id, default: ""], sourceWorksheetID: worksheet.id)
            }
        }
    }

    private var importedBinding: Binding<Bool> {
        Binding {
            worksheet.imported[field.id] == true
        } set: { newValue in
            worksheet.imported[field.id] = newValue
        }
    }

    private var inputBackground: Color {
        field.isShared ? Color(.secondarySystemBackground) : Color(.systemBackground)
    }

    private var isLongTextFocused: Bool {
        focusedLongTextField == field.id
    }
}

private struct MediaAssetsInput: View {
    let field: SubmissionField
    @Binding var worksheet: SubmissionWorksheet
    let isEditing: Bool
    @State private var templateMessage = ""

    private let previewSlots = (1...3).map { MediaAssetSlot(kind: "App Preview", index: $0, key: "appPreview\($0)", folderName: "app-preview-\($0)") }
    private let screenshotSlots = (1...10).map { MediaAssetSlot(kind: "Screenshot", index: $0, key: "screenshot\($0)", folderName: "screenshot-\($0)") }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("App previews: up to 3. Screenshots: up to 10.")
                    .font(.footnote.weight(.semibold))
                Text("Use one asset folder with the subfolders below so each upload slot is obvious when you move into App Store Connect.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            TextField("Asset folder path or Drive folder link", text: folderBinding)
                .textFieldStyle(.roundedBorder)
                .submitLabel(.done)

            Button {
                createFolderTemplate()
            } label: {
                Label("Create Folder Template", systemImage: "folder.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(!isEditing)

            if !templateMessage.isEmpty {
                Text(templateMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            assetGroup(title: "App Previews", subtitle: "Optional videos, maximum 3", slots: previewSlots)
            assetGroup(title: "Screenshots", subtitle: "Images, maximum 10", slots: screenshotSlots)
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color(.separator).opacity(0.28))
        )
        .disabled(!isEditing)
        .onAppear {
            refreshSummary()
        }
    }

    private func assetGroup(title: String, subtitle: String, slots: [MediaAssetSlot]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 0) {
                ForEach(Array(slots.enumerated()), id: \.element.id) { index, slot in
                    assetRow(slot)
                    if index < slots.count - 1 {
                        Divider()
                            .padding(.leading, 34)
                    }
                }
            }
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(Color(.separator).opacity(0.22))
            )
        }
    }

    private func assetRow(_ slot: MediaAssetSlot) -> some View {
        HStack(alignment: .center, spacing: 9) {
            Button {
                let isReady = worksheet.values[key("\(slot.key)Ready")] == "true"
                setValue(isReady ? "" : "true", for: key("\(slot.key)Ready"))
            } label: {
                Image(systemName: worksheet.values[key("\(slot.key)Ready")] == "true" ? "checkmark.square.fill" : "square")
                    .font(.body.weight(.medium))
                    .foregroundStyle(worksheet.values[key("\(slot.key)Ready")] == "true" ? Color(.systemBlue) : Color(.tertiaryLabel))
            }
            .buttonStyle(.plain)
            .disabled(!isEditing)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(slot.kind) \(slot.index)")
                    .font(.footnote.weight(.medium))
                Text(slot.folderName)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: 8)

            TextField("file / note", text: noteBinding(for: slot))
                .textFieldStyle(.roundedBorder)
                .font(.caption)
                .frame(maxWidth: 128)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .frame(minHeight: 46)
    }

    private var folderBinding: Binding<String> {
        Binding {
            worksheet.values[key("assetFolder"), default: ""]
        } set: { newValue in
            setValue(newValue, for: key("assetFolder"))
        }
    }

    private func noteBinding(for slot: MediaAssetSlot) -> Binding<String> {
        Binding {
            worksheet.values[key("\(slot.key)Note"), default: ""]
        } set: { newValue in
            setValue(newValue, for: key("\(slot.key)Note"))
        }
    }

    private func setValue(_ value: String, for key: String) {
        worksheet.values[key] = value
        worksheet.imported[field.id] = false
        refreshSummary()
    }

    private func key(_ suffix: String) -> String {
        "\(field.id).\(suffix)"
    }

    private func refreshSummary() {
        let previewCount = previewSlots.filter { worksheet.values[key("\($0.key)Ready")] == "true" }.count
        let screenshotCount = screenshotSlots.filter { worksheet.values[key("\($0.key)Ready")] == "true" }.count
        let folder = worksheet.values[key("assetFolder"), default: ""]

        if previewCount == 0 && screenshotCount == 0 && folder.isEmpty {
            worksheet.values[field.id] = ""
        } else {
            worksheet.values[field.id] = "Folder: \(folder.isEmpty ? "Not entered" : folder). App previews: \(previewCount)/3. Screenshots: \(screenshotCount)/10."
        }
    }

    private func createFolderTemplate() {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return }
        let root = documents
            .appendingPathComponent("AuthorityConnectAssets", isDirectory: true)
            .appendingPathComponent(safeFolderName, isDirectory: true)
            .appendingPathComponent("previews-and-screenshots", isDirectory: true)

        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            for slot in previewSlots + screenshotSlots {
                try FileManager.default.createDirectory(at: root.appendingPathComponent(slot.folderName, isDirectory: true), withIntermediateDirectories: true)
            }
            setValue(root.path, for: key("assetFolder"))
            templateMessage = "Created folder template with 3 app preview folders and 10 screenshot folders."
        } catch {
            templateMessage = "Could not create the folder template: \(error.localizedDescription)"
        }
    }

    private var safeFolderName: String {
        let base = worksheet.name.isEmpty ? "untitled-app" : worksheet.name
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_ "))
        let cleaned = String(base.unicodeScalars.map { allowed.contains($0) ? Character($0) : "-" })
            .replacingOccurrences(of: " ", with: "-")
            .lowercased()
        return cleaned.isEmpty ? "untitled-app" : cleaned
    }
}

private struct MediaAssetSlot: Identifiable {
    var id: String { key }
    let kind: String
    let index: Int
    let key: String
    let folderName: String
}

enum PhoneNumberFormatter {
    static func usDisplay(_ value: String) -> String {
        let digits = value.filter(\.isNumber)
        let limited = String(digits.prefix(10))

        switch limited.count {
        case 0:
            return ""
        case 1...3:
            return "(\(limited)"
        case 4...6:
            let area = limited.prefix(3)
            let prefix = limited.dropFirst(3)
            return "(\(area)) \(prefix)"
        default:
            let area = limited.prefix(3)
            let prefixStart = limited.index(limited.startIndex, offsetBy: 3)
            let lineStart = limited.index(limited.startIndex, offsetBy: 6)
            let prefix = limited[prefixStart..<lineStart]
            let line = limited[lineStart...]
            return "(\(area)) \(prefix)-\(line)"
        }
    }
}
