(() => {
  const storageKey = "adc_app_store_worksheets_v2";
  const legacyStorageKey = "adc_app_store_worksheets_v1";
  const profileStorageKey = "adc_app_store_submission_profile_v1";
  const sharedFieldNames = new Set([
    "App owner name",
    "Owner email",
    "Apple Developer account holder",
    "Apple Developer Team ID",
    "App Store Connect access role",
    "Contact first name",
    "Contact last name",
    "Contact phone",
    "Contact email",
    "Primary language",
    "Content rights",
    "Copyright",
    "Release preference"
  ]);
  const statuses = [
    "Preparing metadata",
    "Build uploaded",
    "Ready to add for review",
    "Submitted",
    "Rejected / needs fixes"
  ];
  let activeRecordId = null;
  let historyIndex = -1;
  let autosaveTimer = null;
  let isHydrating = false;

  function finishLoading() {
    window.setTimeout(() => {
      document.body.classList.remove("is-loading");
      document.body.classList.add("is-ready");
    }, 280);
  }

  function readRecords() {
    try {
      const records = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (Array.isArray(records)) return records;
    } catch {}

    try {
      const legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || "[]");
      const migrated = Array.isArray(legacy) ? legacy.map(ensureRecordShape) : [];
      writeRecords(migrated);
      return migrated;
    } catch {
      return [];
    }
  }

  function writeRecords(records) {
    localStorage.setItem(storageKey, JSON.stringify(records));
  }

  function readProfile() {
    try {
      const profile = JSON.parse(localStorage.getItem(profileStorageKey) || "{}");
      return profile && typeof profile === "object" ? profile : {};
    } catch {
      return {};
    }
  }

  function writeProfile(profile) {
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  }

  function updateProfileValue(name, value) {
    if (!sharedFieldNames.has(name)) return;
    const profile = readProfile();
    profile[name] = value;
    writeProfile(profile);
    syncProfileToRecords(name, value);
  }

  function formatUSPhone(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 10);
    if (!digits) return "";
    if (digits.length <= 3) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  function normalizeInputValue(input) {
    if (input?.type === "tel" || /phone/i.test(input?.name || "")) {
      input.value = formatUSPhone(input.value);
    }
  }

  function syncProfileToRecords(name, value) {
    const records = readRecords().map((record) => ensureRecordShape({
      ...record,
      sections: (record.sections || []).map((section) => ({
        ...section,
        fields: (section.fields || []).map((field) => (
          field.name === name
            ? { ...field, value, imported: false, shared: true }
            : field
        ))
      })),
      updatedAt: nowISO()
    }));
    writeRecords(records);
  }

  function escapeHTML(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function makeId() {
    return `worksheet_${Date.now()}_${crypto.randomUUID()}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function allFields(record) {
    return (record.sections || []).flatMap((section) => (section.fields || []).map((field) => ({ section: section.title, ...field })));
  }

  function getField(record, name) {
    return allFields(record).find((field) => field.name === name)?.value || "";
  }

  function summarize(record) {
    return {
      appName: getField(record, "App name") || record.appName || "Untitled app",
      bundleId: getField(record, "Bundle ID") || record.bundleId || "",
      version: getField(record, "Version number") || record.version || "",
      status: getField(record, "Submission status") || record.status || "Preparing metadata"
    };
  }

  function ensureRecordShape(record) {
    const summary = summarize(record);
    return {
      ...record,
      ...summary,
      id: record.id || makeId(),
      createdAt: record.createdAt || nowISO(),
      updatedAt: record.updatedAt || nowISO(),
      history: Array.isArray(record.history) && record.history.length
        ? record.history
        : [{ at: record.updatedAt || nowISO(), reason: "Created", sections: record.sections || [] }]
    };
  }

  function collectWorksheet(form, existing = null, reason = "Saved") {
    const existingFields = new Map(allFields(existing || { sections: [] }).map((field) => [field.name, field]));
    const sections = [...form.querySelectorAll("fieldset")].map((fieldset) => {
      const title = fieldset.dataset.section || fieldset.querySelector("legend")?.textContent?.trim() || "Section";
      const fields = [...fieldset.querySelectorAll("input, select, textarea")]
        .filter((input) => input.name)
        .map((input) => {
          const value = String(input.value || "").trim();
          const previous = existingFields.get(input.name);
          return {
            label: input.closest("label")?.childNodes[0]?.textContent?.trim() || input.name,
            name: input.name,
            value,
            required: input.required,
            shared: sharedFieldNames.has(input.name),
            imported: Boolean(previous?.imported && previous.value === value),
            importedAt: previous?.imported && previous.value === value ? previous.importedAt || "" : ""
          };
        });

      return { title, fields };
    });

    const base = existing || {};
    const record = ensureRecordShape({
      ...base,
      id: base.id || makeId(),
      sections,
      createdAt: base.createdAt || nowISO(),
      updatedAt: nowISO()
    });
    const last = record.history[record.history.length - 1];
    if (JSON.stringify(last?.sections || []) !== JSON.stringify(sections)) {
      record.history = [...record.history, { at: record.updatedAt, reason, sections }];
    }
    return record;
  }

  function missingRequired(record) {
    return allFields(record).filter((field) => field.required && !field.value);
  }

  function qualityIssues(record) {
    const issues = [];
    const fields = allFields(record);
    const value = (name) => fields.find((field) => field.name === name)?.value || "";
    const requireIf = (condition, name, message) => {
      if (condition && !value(name)) issues.push({ name, message });
    };
    const appName = value("App name");
    const subtitle = value("Subtitle");
    const keywords = value("Keywords");
    const supportUrl = value("Support URL");
    const privacyUrl = value("Privacy Policy URL");
    const buildSelected = value("Build selected in App Store Connect");
    const role = value("App Store Connect access role");

    if (appName.length > 30) issues.push({ name: "App name", message: "App name must be 30 characters or fewer." });
    if (subtitle.length > 30) issues.push({ name: "Subtitle", message: "Subtitle must be 30 characters or fewer." });
    if (keywords.length > 100) issues.push({ name: "Keywords", message: "Keywords should stay within Apple's 100 character limit." });
    if (supportUrl && !supportUrl.startsWith("https://")) issues.push({ name: "Support URL", message: "Support URL should be a public HTTPS URL." });
    if (privacyUrl && !privacyUrl.startsWith("https://")) issues.push({ name: "Privacy Policy URL", message: "Privacy Policy URL should be a public HTTPS URL." });
    if (buildSelected !== "Yes") issues.push({ name: "Build selected in App Store Connect", message: "Select the correct build before adding the version for review." });
    if (!["Account Holder", "Admin", "App Manager"].includes(role)) {
      issues.push({ name: "App Store Connect access role", message: "Submission usually requires Account Holder, Admin, or App Manager access." });
    }

    requireIf(value("Sign-in required for reviewer") === "Yes", "Review username", "Reviewer username is needed when sign-in is required.");
    requireIf(value("Sign-in required for reviewer") === "Yes", "Review password", "Reviewer password is needed when sign-in is required.");
    requireIf(value("App collects user data") === "Yes", "Data types collected", "List data types collected before completing App Privacy.");
    requireIf(value("App collects user data") === "Yes", "Data use purpose", "List data use purposes before completing App Privacy.");
    requireIf(value("Uses third-party SDKs") === "Yes", "Data types collected", "Third-party SDK data practices need privacy review.");
    requireIf(value("In-app purchases") === "Yes", "Monetization notes", "Document in-app purchase details before submission.");
    requireIf(value("Subscriptions") === "Yes", "Monetization notes", "Document subscription details before submission.");
    return issues;
  }

  function readiness(record) {
    const fields = allFields(record);
    const required = fields.filter((field) => field.required);
    const completeRequired = required.filter((field) => field.value).length;
    const issues = qualityIssues(record);
    const requiredScore = required.length ? completeRequired / required.length : 1;
    const issuePenalty = Math.min(0.35, issues.length * 0.04);
    const score = Math.max(0, Math.round((requiredScore - issuePenalty) * 100));
    const sections = record.sections.map((section) => {
      const sectionRequired = section.fields.filter((field) => field.required);
      const missing = sectionRequired.filter((field) => !field.value);
      const sectionIssues = issues.filter((issue) => section.fields.some((field) => field.name === issue.name));
      return {
        title: section.title,
        missing: missing.length,
        issues: sectionIssues.length,
        complete: sectionRequired.length ? sectionRequired.length - missing.length : section.fields.filter((field) => field.value).length,
        total: sectionRequired.length || section.fields.length
      };
    });
    return { score, missing: missingRequired(record), issues, sections };
  }

  function importProgress(record) {
    const fields = allFields(record).filter((field) => field.value);
    const imported = fields.filter((field) => field.imported).length;
    return {
      imported,
      total: fields.length,
      percent: fields.length ? Math.round((imported / fields.length) * 100) : 0
    };
  }

  function fieldByName(form, name) {
    return [...form.querySelectorAll("input, select, textarea")].find((input) => input.name === name);
  }

  function focusField(form, name) {
    const field = fieldByName(form, name);
    if (!field) return;
    field.focus();
    field.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderReadiness(form, record) {
    const panel = document.querySelector("[data-readiness-panel]");
    if (!panel) return;
    const data = readiness(record);
    const score = document.querySelector("[data-readiness-score]");
    const summary = document.querySelector("[data-readiness-summary]");
    const bar = document.querySelector("[data-readiness-bar]");
    const checks = document.querySelector("[data-readiness-checks]");
    const jump = document.querySelector("[data-section-jump]");

    score.textContent = `${data.score}%`;
    summary.textContent = `${data.missing.length} required missing / ${data.issues.length} review warnings`;
    bar.style.width = `${data.score}%`;
    panel.dataset.state = data.score >= 90 && data.issues.length === 0 ? "ready" : data.score >= 70 ? "review" : "blocked";
    checks.innerHTML = [...data.missing.slice(0, 4).map((field) => `
      <button type="button" data-focus-field="${escapeHTML(field.name)}">Missing: ${escapeHTML(field.label)}</button>
    `), ...data.issues.slice(0, 4).map((issue) => `
      <button type="button" data-focus-field="${escapeHTML(issue.name)}">Check: ${escapeHTML(issue.message)}</button>
    `)].join("") || "<span>No required gaps detected.</span>";

    jump.innerHTML = record.sections.map((section, index) => {
      const state = data.sections[index];
      const label = state.missing || state.issues ? `${state.missing} missing / ${state.issues} checks` : "OK";
      return `<button type="button" data-jump-section="${index}">${escapeHTML(section.title)} <span>${label}</span></button>`;
    }).join("");

    checks.onclick = (event) => {
      const name = event.target?.dataset?.focusField;
      if (name) focusField(form, name);
    };

    jump.onclick = (event) => {
      const button = event.target.closest("[data-jump-section]");
      if (!button) return;
      const fieldset = form.querySelectorAll("fieldset")[Number(button.dataset.jumpSection)];
      fieldset?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function markRequiredLabels(form) {
    [...form.querySelectorAll("input[required], select[required], textarea[required]")].forEach((input) => {
      input.closest("label")?.classList.add("is-required");
      input.setAttribute("aria-required", "true");
    });
  }

  function findRecord(id) {
    return readRecords().find((record) => record.id === id);
  }

  function saveRecord(record) {
    const shaped = ensureRecordShape(record);
    const records = readRecords();
    const index = records.findIndex((item) => item.id === shaped.id);
    if (index >= 0) records[index] = shaped;
    else records.unshift(shaped);
    writeRecords(records);
    return shaped;
  }

  function setFormDisabled(form, disabled) {
    [...form.elements].forEach((element) => {
      if (element.matches("[data-edit-toggle], [data-save-button], [data-clear-button], [data-history-prev], [data-history-next], [data-history-restore]")) return;
      element.disabled = disabled;
    });
    form.classList.toggle("is-locked", disabled);
  }

  function applySectionsToForm(form, sections) {
    isHydrating = true;
    const fields = sections.flatMap((section) => section.fields);
    const profile = readProfile();
    [...form.querySelectorAll("input, select, textarea")].forEach((input) => {
      if (!input.name) return;
      const field = fields.find((item) => item.name === input.name);
      if (field) input.value = field.value || "";
      else if (sharedFieldNames.has(input.name)) input.value = profile[input.name] || "";
    });
    isHydrating = false;
  }

  function applyProfileToForm(form) {
    const profile = readProfile();
    isHydrating = true;
    [...form.querySelectorAll("input, select, textarea")].forEach((input) => {
      if (!sharedFieldNames.has(input.name)) return;
      input.closest("label")?.classList.add("is-shared-profile");
      input.dataset.sharedProfile = "true";
      if (!input.value && profile[input.name]) input.value = profile[input.name];
    });
    isHydrating = false;
  }

  function updateHistoryControls(record) {
    const label = document.querySelector("[data-history-label]");
    const previous = document.querySelector("[data-history-prev]");
    const next = document.querySelector("[data-history-next]");
    const restore = document.querySelector("[data-history-restore]");
    if (!label || !previous || !next || !restore) return;

    const total = record.history?.length || 0;
    const visible = total > 0;
    [label, previous, next, restore].forEach((element) => element.classList.toggle("hidden", !visible));
    if (!visible) return;

    const snapshot = record.history[historyIndex] || record.history[total - 1];
    label.textContent = `Version ${historyIndex + 1} of ${total} / ${new Date(snapshot.at).toLocaleString()}`;
    previous.disabled = historyIndex <= 0;
    next.disabled = historyIndex >= total - 1;
    restore.disabled = historyIndex === total - 1;
  }

  function bindIntake() {
    const form = document.querySelector("[data-authority-intake]");
    if (!form) return;

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get("id");
    const status = document.querySelector("[data-authority-status]");
    const title = document.querySelector("[data-authority-title]");
    const saveButton = document.querySelector("[data-save-button]");
    const clearButton = document.querySelector("[data-clear-button]");
    const editToggle = document.querySelector("[data-edit-toggle]");
    const editWrap = document.querySelector("[data-edit-toggle-wrap]");
    const previous = document.querySelector("[data-history-prev]");
    const next = document.querySelector("[data-history-next]");
    const restore = document.querySelector("[data-history-restore]");
    let activeRecord = requestedId ? findRecord(requestedId) : null;
    markRequiredLabels(form);
    applyProfileToForm(form);

    if (requestedId && !activeRecord) {
      status.textContent = "That local worksheet could not be found.";
    }

    if (activeRecord) {
      activeRecord = ensureRecordShape(activeRecord);
      activeRecordId = activeRecord.id;
      historyIndex = activeRecord.history.length - 1;
      applySectionsToForm(form, activeRecord.sections);
      title.textContent = activeRecord.appName;
      saveButton.textContent = "Saved";
      clearButton.classList.add("hidden");
      editWrap.classList.remove("hidden");
      setFormDisabled(form, true);
      updateHistoryControls(activeRecord);
      renderReadiness(form, activeRecord);
      status.textContent = "Opened read-only. Turn on Edit to make autosaved changes.";
    } else {
      editToggle.checked = true;
      setFormDisabled(form, false);
      renderReadiness(form, collectWorksheet(form));
    }

    editToggle?.addEventListener("change", () => {
      const editing = editToggle.checked;
      setFormDisabled(form, !editing);
      status.textContent = editing ? "Editing on. Changes autosave." : "Editing off. Worksheet locked.";
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const existing = activeRecordId ? findRecord(activeRecordId) : null;
      const record = collectWorksheet(form, existing, existing ? "Manual save" : "Created");
      const missing = missingRequired(record);

      if (!activeRecordId && missing.length) {
        status.textContent = `Missing ${missing.length} required field${missing.length === 1 ? "" : "s"}.`;
        const first = form.elements[missing[0].name];
        first?.focus();
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }

      activeRecord = saveRecord(record);
      activeRecordId = activeRecord.id;
      historyIndex = activeRecord.history.length - 1;
      title.textContent = activeRecord.appName;
      updateHistoryControls(activeRecord);
      status.textContent = activeRecordId ? "Saved locally." : "Worksheet saved locally.";
      if (!requestedId) window.history.replaceState({}, "", `intake.html?id=${encodeURIComponent(activeRecord.id)}`);
      editWrap.classList.remove("hidden");
      clearButton.classList.add("hidden");
      saveButton.textContent = "Saved";
      renderReadiness(form, activeRecord);
    });

    function scheduleAutosave() {
      if (isHydrating || !activeRecordId || !editToggle.checked) return;
      renderReadiness(form, collectWorksheet(form, findRecord(activeRecordId), "Preview"));
      clearTimeout(autosaveTimer);
      status.textContent = "Autosaving...";
      autosaveTimer = setTimeout(() => {
        const existing = findRecord(activeRecordId);
        activeRecord = saveRecord(collectWorksheet(form, existing, "Autosave"));
        historyIndex = activeRecord.history.length - 1;
        title.textContent = activeRecord.appName;
        updateHistoryControls(activeRecord);
        renderReadiness(form, activeRecord);
        status.textContent = "Autosaved.";
      }, 550);
    }

    form.addEventListener("input", (event) => {
      const target = event.target;
      normalizeInputValue(target);
      if (target?.name) updateProfileValue(target.name, String(target.value || "").trim());
      if (!activeRecordId) renderReadiness(form, collectWorksheet(form));
      scheduleAutosave();
    });
    form.addEventListener("change", (event) => {
      const target = event?.target;
      normalizeInputValue(target);
      if (target?.name) updateProfileValue(target.name, String(target.value || "").trim());
      if (!activeRecordId) renderReadiness(form, collectWorksheet(form));
      scheduleAutosave();
    });

    previous?.addEventListener("click", () => {
      const record = findRecord(activeRecordId);
      if (!record || historyIndex <= 0) return;
      historyIndex -= 1;
      applySectionsToForm(form, record.history[historyIndex].sections);
      updateHistoryControls(record);
      renderReadiness(form, ensureRecordShape({ ...record, sections: record.history[historyIndex].sections }));
      status.textContent = "Viewing older version. Use Replace to restore it.";
    });

    next?.addEventListener("click", () => {
      const record = findRecord(activeRecordId);
      if (!record || historyIndex >= record.history.length - 1) return;
      historyIndex += 1;
      applySectionsToForm(form, record.history[historyIndex].sections);
      updateHistoryControls(record);
      renderReadiness(form, ensureRecordShape({ ...record, sections: record.history[historyIndex].sections }));
      status.textContent = historyIndex === record.history.length - 1 ? "Viewing latest version." : "Viewing history.";
    });

    restore?.addEventListener("click", () => {
      const record = findRecord(activeRecordId);
      if (!record || historyIndex < 0) return;
      const restored = ensureRecordShape({
        ...record,
        sections: record.history[historyIndex].sections,
        updatedAt: nowISO(),
        history: [...record.history, { at: nowISO(), reason: "Restored version", sections: record.history[historyIndex].sections }]
      });
      activeRecord = saveRecord(restored);
      historyIndex = activeRecord.history.length - 1;
      applySectionsToForm(form, activeRecord.sections);
      updateHistoryControls(activeRecord);
      renderReadiness(form, activeRecord);
      status.textContent = "Viewed version restored as the latest worksheet.";
    });
  }

  function deleteRecord(id) {
    writeRecords(readRecords().filter((record) => record.id !== id));
  }

  function fieldBlock(field) {
    const value = field.value || "";
    const isMissing = field.required && !value;
    const isImported = Boolean(field.imported);
    return `
      <div class="authority-field ${isMissing ? "is-missing" : ""}">
        <dt>${escapeHTML(field.label)}${field.required ? " *" : ""}</dt>
        <dd>
          <label class="import-check" title="Mark this field as imported into App Store Connect">
            <input type="checkbox" data-import-field="${escapeHTML(field.name)}" ${isImported ? "checked" : ""} ${value ? "" : "disabled"}>
            <span>Imported</span>
          </label>
          <button class="copy-chip" type="button" data-copy-value="${escapeHTML(value)}">Copy</button>
          <span>${value ? escapeHTML(value) : "Missing"}</span>
        </dd>
      </div>
    `;
  }

  function renderRecord(record) {
    const shaped = ensureRecordShape(record);
    const missing = missingRequired(shaped);
    const ready = readiness(shaped);
    const progress = importProgress(shaped);
    const created = new Date(shaped.createdAt).toLocaleString();
    const updated = new Date(shaped.updatedAt).toLocaleString();

    return `
      <article class="authority-record" data-record-id="${escapeHTML(shaped.id)}">
        <div class="admin-card-top">
          <div>
            <p class="kicker">${escapeHTML(shaped.bundleId || "No Bundle ID")} / ${escapeHTML(shaped.version || "No version")}</p>
            <h2>${escapeHTML(shaped.appName)}</h2>
            <p>${ready.score}% ready / ${progress.percent}% imported / ${missing.length ? `${missing.length} required fields missing` : "Required fields complete"} / ${ready.issues.length} review checks / Updated ${updated}</p>
          </div>
          <select data-status-for="${escapeHTML(shaped.id)}">
            ${statuses.map((option) => `
              <option ${shaped.status === option ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
        </div>

        <div class="authority-record-actions">
          <a class="button" href="intake.html?id=${encodeURIComponent(shaped.id)}">Open worksheet</a>
          <button class="button button-secondary" type="button" data-export-record="${escapeHTML(shaped.id)}">Export this worksheet</button>
          <button class="footer-sign-in" type="button" data-delete-record="${escapeHTML(shaped.id)}">Delete</button>
        </div>

        <div class="readiness-meter compact" aria-label="${ready.score}% ready">
          <span style="width: ${ready.score}%"></span>
        </div>
        <div class="import-progress">
          <span>${progress.imported} of ${progress.total} filled fields imported</span>
          <div class="readiness-meter compact secondary" aria-label="${progress.percent}% imported">
            <span style="width: ${progress.percent}%"></span>
          </div>
        </div>

        ${shaped.sections.map((section) => `
          <section class="authority-result-section">
            <h3>${escapeHTML(section.title)}</h3>
            <dl>${section.fields.map(fieldBlock).join("")}</dl>
          </section>
        `).join("")}
      </article>
    `;
  }

  function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function updateRecord(id, patch) {
    const records = readRecords().map((record) => {
      if (record.id !== id) return record;
      const { importFieldName, imported, ...recordPatch } = patch;
      let sections = record.sections;
      if (recordPatch.status) {
        sections = record.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => (
            field.name === "Submission status" ? { ...field, value: recordPatch.status } : field
          ))
        }));
      }
      if (importFieldName) {
        sections = record.sections.map((section) => ({
          ...section,
          fields: section.fields.map((field) => (
            field.name === importFieldName
              ? {
                  ...field,
                  imported,
                  importedAt: imported ? nowISO() : ""
                }
              : field
          ))
        }));
      }
      return ensureRecordShape({ ...record, ...recordPatch, sections, updatedAt: nowISO() });
    });
    writeRecords(records);
  }

  function renderResults() {
    const container = document.querySelector("[data-authority-results]");
    if (!container) return;

    const search = document.querySelector("[data-authority-search]");
    const filter = document.querySelector("[data-authority-filter]");
    const status = document.querySelector("[data-authority-status]");
    const query = String(search?.value || "").trim().toLowerCase();
    const selectedStatus = filter?.value || "All";
    const allRecords = readRecords().map(ensureRecordShape);
    renderDashboard(allRecords);
    const records = allRecords.filter((record) => {
      const blob = JSON.stringify(record).toLowerCase();
      const matchesQuery = !query || blob.includes(query);
      const matchesStatus = selectedStatus === "All" || record.status === selectedStatus;
      return matchesQuery && matchesStatus;
    });

    if (!records.length) {
      container.innerHTML = '<article class="authority-empty">No saved App Store worksheets match this view.</article>';
      status.textContent = `${allRecords.length} total local worksheets.`;
      return;
    }

    container.innerHTML = records.map(renderRecord).join("");
    status.textContent = `${records.length} shown / ${allRecords.length} total local worksheets.`;
  }

  function renderDashboard(records) {
    const dashboard = document.querySelector("[data-authority-dashboard]");
    if (!dashboard) return;
    const readyScores = records.map((record) => readiness(record));
    const importScores = records.map((record) => importProgress(record));
    const average = readyScores.length
      ? Math.round(readyScores.reduce((sum, item) => sum + item.score, 0) / readyScores.length)
      : 0;
    const readyCount = readyScores.filter((item) => item.score >= 90 && item.missing.length === 0 && item.issues.length === 0).length;
    const blockers = readyScores.reduce((sum, item) => sum + item.missing.length + item.issues.length, 0);
    const importAverage = importScores.length
      ? Math.round(importScores.reduce((sum, item) => sum + item.percent, 0) / importScores.length)
      : 0;
    const newest = records.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    dashboard.innerHTML = `
      <article>
        <strong>${records.length}</strong>
        <span>Local files</span>
      </article>
      <article>
        <strong>${average}%</strong>
        <span>Average readiness</span>
      </article>
      <article>
        <strong>${readyCount}</strong>
        <span>Review-ready</span>
      </article>
      <article>
        <strong>${blockers}</strong>
        <span>Open checks</span>
      </article>
      <article>
        <strong>${importAverage}%</strong>
        <span>Imported</span>
      </article>
      ${newest ? `<article><strong>${escapeHTML(newest.appName)}</strong><span>Last edited</span></article>` : ""}
    `;
  }

  function bindResults() {
    const container = document.querySelector("[data-authority-results]");
    if (!container) return;

    document.querySelector("[data-authority-search]")?.addEventListener("input", renderResults);
    document.querySelector("[data-authority-filter]")?.addEventListener("change", renderResults);
    document.querySelector("[data-authority-export]")?.addEventListener("click", () => {
      downloadJSON(`app-store-worksheets-${new Date().toISOString().slice(0, 10)}.json`, readRecords());
    });

    container.addEventListener("change", (event) => {
      const id = event.target?.dataset?.statusFor;
      if (id) {
        updateRecord(id, { status: event.target.value });
        renderResults();
        return;
      }

      const importFieldName = event.target?.dataset?.importField;
      if (importFieldName) {
        const card = event.target.closest("[data-record-id]");
        if (!card) return;
        updateRecord(card.dataset.recordId, {
          importFieldName,
          imported: event.target.checked
        });
        renderResults();
      }
    });

    container.addEventListener("click", async (event) => {
      const deleteId = event.target?.dataset?.deleteRecord;
      if (deleteId) {
        deleteRecord(deleteId);
        renderResults();
        return;
      }

      const exportId = event.target?.dataset?.exportRecord;
      if (exportId) {
        const record = readRecords().find((item) => item.id === exportId);
        if (record) downloadJSON(`${ensureRecordShape(record).appName.replaceAll(/\W+/g, "-").toLowerCase()}-app-store-worksheet.json`, ensureRecordShape(record));
        return;
      }

      const copyValue = event.target?.dataset?.copyValue;
      if (copyValue !== undefined) {
        await navigator.clipboard?.writeText(copyValue);
        event.target.textContent = "Copied";
        setTimeout(() => {
          event.target.textContent = "Copy";
        }, 900);
      }
    });

    renderResults();
  }

  bindIntake();
  bindResults();
  finishLoading();
})();
