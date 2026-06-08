import SwiftUI
import UIKit

struct ContentView: View {
    @EnvironmentObject private var store: SubmissionStore
    @State private var selectedID: SubmissionWorksheet.ID?
    @State private var showLaunch = true
    @State private var showAccountConfiguration = false
    @State private var renameTarget: SubmissionWorksheet?
    @State private var renameText = ""
    @State private var deleteTarget: SubmissionWorksheet?
    @State private var exportedLongForm: ExportedLongFormFile?
    @State private var exportErrorMessage = ""

    var body: some View {
        ZStack {
            NavigationSplitView {
                List(selection: $selectedID) {
                    Section("Account") {
                        Button {
                            showAccountConfiguration = true
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "person.crop.circle")
                                    .font(.title3)
                                    .foregroundStyle(.secondary)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(accountName)
                                        .font(.headline)
                                    Text("\(completedProfileCount) of \(SubmissionSchema.sharedFields.count) profile fields")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                        .buttonStyle(.plain)
                    }

                    Section("Apps") {
                        ForEach(store.worksheets) { worksheet in
                            appRow(for: worksheet)
                            .tag(worksheet.id)
                        }
                        .onDelete { offsets in
                            offsets.map { store.worksheets[$0] }.forEach(store.delete)
                            selectedID = store.worksheets.first?.id
                        }
                    }
                }
                .navigationTitle("Apps")
                .toolbar {
                    if let selectedWorksheet {
                        Button {
                            exportLongForm(selectedWorksheet)
                        } label: {
                            Label("Export", systemImage: "doc.richtext")
                        }
                    }

                    Button {
                        let worksheet = store.createWorksheet()
                        selectedID = worksheet.id
                    } label: {
                        Label("New", systemImage: "plus")
                    }
                }
            } detail: {
                if let worksheet = selectedWorksheet {
                    SubmissionEditor(worksheet: worksheet)
                        .id(worksheet.id)
                } else {
                    ContentUnavailableView("No Worksheet", systemImage: "doc.text", description: Text("Create or select an app submission worksheet."))
                }
            }
            .onAppear {
                selectedID = selectedID ?? store.worksheets.first?.id
            }
            .sheet(isPresented: $showAccountConfiguration) {
                AccountConfigurationView()
                    .environmentObject(store)
            }
            .sheet(item: $exportedLongForm) { export in
                ActivityView(activityItems: [export.url])
            }
            .alert("Export Failed", isPresented: exportErrorBinding) {
                Button("OK", role: .cancel) {
                    exportErrorMessage = ""
                }
            } message: {
                Text(exportErrorMessage)
            }
            .alert("Rename App", isPresented: renameAlertBinding) {
                TextField("App name", text: $renameText)
                Button("Cancel", role: .cancel) {
                    clearRename()
                }
                Button("Rename") {
                    if let renameTarget {
                        store.rename(renameTarget, to: renameText)
                        selectedID = renameTarget.id
                    }
                    clearRename()
                }
            } message: {
                Text("Update the listed worksheet name.")
            }
            .confirmationDialog("Delete App Worksheet?", isPresented: deleteDialogBinding, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    if let deleteTarget {
                        store.delete(deleteTarget)
                        if selectedID == deleteTarget.id {
                            selectedID = store.worksheets.first?.id
                        }
                    }
                    deleteTarget = nil
                }
                Button("Cancel", role: .cancel) {
                    deleteTarget = nil
                }
            } message: {
                if let deleteTarget {
                    Text("Delete \(deleteTarget.name)? This removes the local worksheet from this device.")
                }
            }

            if showLaunch {
                LaunchScreen()
                    .transition(.opacity)
                    .task {
                        try? await Task.sleep(for: .milliseconds(850))
                        withAnimation(.easeOut(duration: 0.28)) {
                            showLaunch = false
                        }
                    }
            }
        }
    }

    private func appRow(for worksheet: SubmissionWorksheet) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(worksheet.name)
                .font(.headline)
            Text(worksheet.bundleID.isEmpty ? "No Bundle ID" : worksheet.bundleID)
                .font(.caption)
                .foregroundStyle(.secondary)
            ProgressView(value: readiness(worksheet))
                .tint(Color(.systemGray))
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .contextMenu {
            Button {
                beginRename(worksheet)
            } label: {
                Label("Rename", systemImage: "pencil")
            }

            Button {
                let duplicate = store.duplicate(worksheet)
                selectedID = duplicate.id
            } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
            }

            ShareLink(item: store.exportText(for: worksheet)) {
                Label("Share", systemImage: "square.and.arrow.up")
            }

            Button {
                exportLongForm(worksheet)
            } label: {
                Label("Export Long Form", systemImage: "doc.richtext")
            }

            ShareLink(item: aiShareText(for: worksheet)) {
                Label("Share for AI Review", systemImage: "brain.head.profile")
            }

            Button(role: .destructive) {
                deleteTarget = worksheet
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    private var exportErrorBinding: Binding<Bool> {
        Binding {
            !exportErrorMessage.isEmpty
        } set: { isPresented in
            if !isPresented {
                exportErrorMessage = ""
            }
        }
    }

    private var renameAlertBinding: Binding<Bool> {
        Binding {
            renameTarget != nil
        } set: { isPresented in
            if !isPresented {
                clearRename()
            }
        }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding {
            deleteTarget != nil
        } set: { isPresented in
            if !isPresented {
                deleteTarget = nil
            }
        }
    }

    private func beginRename(_ worksheet: SubmissionWorksheet) {
        renameTarget = worksheet
        renameText = worksheet.name
    }

    private func clearRename() {
        renameTarget = nil
        renameText = ""
    }

    private func exportLongForm(_ worksheet: SubmissionWorksheet) {
        do {
            let url = try store.exportLongFormHTMLFile(for: worksheet)
            exportedLongForm = ExportedLongFormFile(url: url)
        } catch {
            exportErrorMessage = error.localizedDescription
        }
    }

    private func aiShareText(for worksheet: SubmissionWorksheet) -> String {
        """
        Review this App Store submission worksheet from App Submission Prep. Identify missing, inconsistent, risky, or confusing fields, then return a hardened correction plan.

        \(store.exportText(for: worksheet))
        """
    }

    private var selectedWorksheet: SubmissionWorksheet? {
        guard let selectedID,
              let index = store.worksheets.firstIndex(where: { $0.id == selectedID }) else { return nil }
        return store.worksheets[index]
    }

    private var accountName: String {
        let first = store.sharedProfile["contactFirstName"] ?? ""
        let last = store.sharedProfile["contactLastName"] ?? ""
        let fullName = [first, last].filter { !$0.isEmpty }.joined(separator: " ")
        return fullName.isEmpty ? "Account Configuration" : fullName
    }

    private var completedProfileCount: Int {
        SubmissionSchema.sharedFields.filter { !(store.sharedProfile[$0.id] ?? "").isEmpty }.count
    }

    private func readiness(_ worksheet: SubmissionWorksheet) -> Double {
        let required = SubmissionSchema.requiredFields
        guard !required.isEmpty else { return 1 }
        let complete = required.filter { !(worksheet.values[$0.id] ?? "").isEmpty }.count
        return Double(complete) / Double(required.count)
    }
}

private struct ExportedLongFormFile: Identifiable {
    let id = UUID()
    let url: URL
}

private struct ActivityView: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct AccountConfigurationView: View {
    @EnvironmentObject private var store: SubmissionStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    accountSummary

                    profileSection("Developer Account", fields: [
                        "developerAccountHolder",
                        "developerTeamID",
                        "appStoreAccessRole"
                    ])

                    profileSection("App Review Contact", fields: [
                        "contactFirstName",
                        "contactLastName",
                        "contactEmail",
                        "contactPhone"
                    ])

                    profileSection("Reusable Submission Defaults", fields: [
                        "primaryLanguage",
                        "contentRights",
                        "licenseAgreement",
                        "distributionMethod",
                        "releaseChoice",
                        "copyright"
                    ])

                    appSpecificNote
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.large])
    }

    private var accountSummary: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "person.crop.circle")
                .font(.system(size: 30, weight: .regular))
                .foregroundStyle(Color(.systemBlue))
                .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 3) {
                Text("Reusable Account Profile")
                    .font(.headline)
                Text("\(completedProfileCount) of \(SubmissionSchema.sharedFields.count) fields completed")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)
        }
        .padding(14)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color(.separator).opacity(0.28))
        )
    }

    private var completedProfileCount: Int {
        SubmissionSchema.sharedFields.filter { !(store.sharedProfile[$0.id] ?? "").isEmpty }.count
    }

    private var appSpecificNote: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("App-specific values stay inside each worksheet.")
                .font(.footnote.weight(.semibold))
            Text("Apple ID, Bundle ID, SKU, screenshots, categories, and review assets are not reused automatically.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func profileSection(_ title: String, fields: [String]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                ForEach(Array(fields.enumerated()), id: \.offset) { index, fieldID in
                    profileRow(fieldID)

                    if index < fields.count - 1 {
                        Divider()
                            .padding(.leading, 12)
                    }
                }
            }
            .background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color(.separator).opacity(0.25))
            )
        }
    }

    @ViewBuilder
    private func profileRow(_ fieldID: String) -> some View {
        if let field = SubmissionSchema.sharedFields.first(where: { $0.id == fieldID }) {
            HStack(alignment: .center, spacing: 10) {
                Text(accountLabel(for: field))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.primary)
                    .frame(width: 124, alignment: .leading)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)

                Group {
                    switch field.kind {
                    case .choice(let choices):
                        compactChoiceMenu(field: field, choices: choices)
                    case .longText:
                        TextEditor(text: binding(for: field))
                            .frame(minHeight: 56, maxHeight: 82)
                            .scrollContentBackground(.hidden)
                            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    case .checkbox:
                        Toggle("", isOn: boolBinding(for: field))
                            .labelsHidden()
                            .frame(maxWidth: .infinity, alignment: .trailing)
                    default:
                        TextField(inputPrompt(for: field), text: binding(for: field))
                            .keyboardType(field.id == "contactPhone" ? .phonePad : .default)
                            .textInputAutocapitalization(.words)
                            .multilineTextAlignment(.trailing)
                            .lineLimit(1)
                    }
                }
                .font(.subheadline)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minHeight: 46)
        }
    }

    private func compactChoiceMenu(field: SubmissionField, choices: [String]) -> some View {
        let selected = store.sharedProfile[field.id, default: ""]

        return Menu {
            Button("Select") {
                store.updateSharedValue(fieldID: field.id, value: "")
            }

            ForEach(choices, id: \.self) { choice in
                Button(choice) {
                    store.updateSharedValue(fieldID: field.id, value: choice)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                Text(selected.isEmpty ? "Select" : selected)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .foregroundStyle(selected.isEmpty ? Color(.systemBlue) : Color(.secondaryLabel))
                    .multilineTextAlignment(.trailing)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color(.systemBlue))
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func accountLabel(for field: SubmissionField) -> String {
        switch field.id {
        case "developerAccountHolder":
            return "Account Holder"
        case "developerTeamID":
            return "Team ID"
        case "appStoreAccessRole":
            return "Access Role"
        case "distributionMethod":
            return "Distribution"
        default:
            return field.title
        }
    }

    private func inputPrompt(for field: SubmissionField) -> String {
        if field.id.lowercased().contains("url") {
            return "Add URL"
        }
        if field.id == "copyright" {
            return "2026 Company Name"
        }
        if field.id == "developerTeamID" {
            return "Team ID"
        }
        return "Add"
    }

    private func binding(for field: SubmissionField) -> Binding<String> {
        Binding {
            formattedValue(store.sharedProfile[field.id, default: ""], for: field)
        } set: { newValue in
            store.updateSharedValue(fieldID: field.id, value: formattedValue(newValue, for: field))
        }
    }

    private func formattedValue(_ value: String, for field: SubmissionField) -> String {
        field.id == "contactPhone" ? PhoneNumberFormatter.usDisplay(value) : value
    }

    private func boolBinding(for field: SubmissionField) -> Binding<Bool> {
        Binding {
            store.sharedProfile[field.id] == "true"
        } set: { newValue in
            store.updateSharedValue(fieldID: field.id, value: newValue ? "true" : "")
        }
    }
}

private struct LaunchScreen: View {
    var body: some View {
        ZStack {
            Color(.systemGroupedBackground).ignoresSafeArea()
            VStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Color(.secondarySystemGroupedBackground))
                        .frame(width: 72, height: 72)
                        .shadow(color: .black.opacity(0.08), radius: 24, y: 12)
                    ProgressView()
                        .controlSize(.large)
                        .tint(Color(.systemGray))
                }
                Text("App Submission Prep")
                    .font(.title2.weight(.semibold))
                Text("Preparing App Store submission workspace")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
