import Foundation

enum SubmissionSchema {
    static let releaseOptions = [
        "Manually release this version",
        "Automatically release this version",
        "Automatically release after App Review, no earlier than"
    ]

    static let languageOptions = [
        "English (U.S.)",
        "English (U.K.)",
        "Spanish",
        "French",
        "German",
        "Portuguese",
        "Japanese",
        "Korean",
        "Chinese (Simplified)",
        "Chinese (Traditional)",
        "Other / confirm in App Store Connect"
    ]

    static let categoryOptions = [
        "Books",
        "Business",
        "Developer Tools",
        "Education",
        "Entertainment",
        "Finance",
        "Food & Drink",
        "Games",
        "Graphics & Design",
        "Health & Fitness",
        "Lifestyle",
        "Medical",
        "Music",
        "Navigation",
        "News",
        "Photo & Video",
        "Productivity",
        "Reference",
        "Shopping",
        "Social Networking",
        "Sports",
        "Travel",
        "Utilities",
        "Weather"
    ]

    static let sections: [SubmissionSection] = [
        SubmissionSection(
            id: "prepare",
            title: "Prepare for Submission",
            fields: [
                .init(id: "previewsScreenshots", title: "Previews and Screenshots", required: true, placeholder: "Asset folder with up to 3 app previews and up to 10 screenshots", kind: .mediaAssets),
                .init(id: "promotionalText", title: "Promotional Text", placeholder: "Optional, can be edited without a new app version", kind: .longText),
                .init(id: "description", title: "Description", required: true, placeholder: "Full App Store description", kind: .longText),
                .init(id: "keywords", title: "Keywords", required: true, placeholder: "Comma-separated, 100 characters max"),
                .init(id: "supportURL", title: "Support URL", required: true, placeholder: "Public support page URL for customer help, contact, or troubleshooting"),
                .init(id: "marketingURL", title: "Marketing URL", placeholder: "Optional public product or landing page URL for this app"),
                .init(id: "version", title: "Version", required: true, placeholder: "1.0"),
                .init(id: "copyright", title: "Copyright", required: true, isShared: true, placeholder: "2026 Company Name"),
                .init(id: "routingCoverageFile", title: "Routing App Coverage File", placeholder: "Drive/file link or local path", kind: .file)
            ],
            children: [
                SubmissionSection(
                    id: "aiSourceContext",
                    title: "AI Source Context",
                    subtitle: "Internal source record for the project/build the AI import used to prepare this worksheet.",
                    fields: [
                        .init(id: "aiName", title: "AI System"),
                        .init(id: "repoURL", title: "Repository URL"),
                        .init(id: "repoBranch", title: "Repository Branch"),
                        .init(id: "repoImportSummary", title: "Repo Import Summary", kind: .longText),
                        .init(id: "repoImportProvenance", title: "Repo Import Provenance", kind: .longText),
                        .init(id: "buildProjectPath", title: "Project or Build Path", kind: .file),
                        .init(id: "buildScheme", title: "Scheme"),
                        .init(id: "buildConfiguration", title: "Build Configuration"),
                        .init(id: "buildDisplayName", title: "Display Name"),
                        .init(id: "buildBundleID", title: "Bundle ID"),
                        .init(id: "buildVersion", title: "Version"),
                        .init(id: "buildNumber", title: "Build Number"),
                        .init(id: "aiImportNotes", title: "AI Import Notes", kind: .longText)
                    ]
                ),
                SubmissionSection(
                    id: "reviewInfo",
                    title: "App Review Information",
                    fields: [],
                    children: [
                        SubmissionSection(id: "contactInfo", title: "App Review Contact", fields: [
                            .init(id: "contactFirstName", title: "First Name", required: true, isShared: true),
                            .init(id: "contactLastName", title: "Last Name", required: true, isShared: true),
                            .init(id: "contactEmail", title: "Email", required: true, isShared: true),
                            .init(id: "contactPhone", title: "Phone Number", required: true, isShared: true)
                        ]),
                        SubmissionSection(id: "signinInfo", title: "Sign-In Information", subtitle: "Provide a user name and password so App Review can sign in to your app.", fields: [
                            .init(id: "reviewUsername", title: "Username"),
                            .init(id: "reviewPassword", title: "Password"),
                            .init(id: "reviewNotes", title: "Notes", placeholder: "Reviewer instructions, test flows, demo account context", kind: .longText),
                            .init(id: "reviewAttachment", title: "Attachment", placeholder: "Choose File (Optional)", kind: .file)
                        ])
                    ]
                ),
                SubmissionSection(id: "release", title: "App Store Version Release", subtitle: "Choose when this version becomes available after approval.", fields: [
                    .init(id: "releaseChoice", title: "Release Option", required: true, isShared: true, kind: .choice(releaseOptions)),
                    .init(id: "releaseNoEarlierThan", title: "No Earlier Than", placeholder: "MMM D, YYYY T:TT AM/PM", kind: .dateTime)
                ])
            ]
        ),
        SubmissionSection(
            id: "general",
            title: "General",
            fields: [],
            children: [
                SubmissionSection(
                    id: "appInfo",
                    title: "App Information",
                    fields: [],
                    children: [
                        SubmissionSection(id: "developerAccount", title: "Developer Account Profile", fields: [
                            .init(id: "developerAccountHolder", title: "Apple Developer Account Holder", isShared: true),
                            .init(id: "developerTeamID", title: "Apple Developer Team ID", isShared: true),
                            .init(id: "appStoreAccessRole", title: "App Store Connect Access Role", isShared: true, kind: .choice(["Account Holder", "Admin", "App Manager", "Developer", "Unsure"]))
                        ]),
                        SubmissionSection(id: "localization", title: "Localization Information", fields: [
                            .init(id: "name", title: "Name", required: true),
                            .init(id: "subtitle", title: "Subtitle")
                        ]),
                        SubmissionSection(id: "generalInfo", title: "General Information", fields: [
                            .init(id: "bundleID", title: "Bundle ID", required: true, placeholder: "com.company.app"),
                            .init(id: "sku", title: "SKU", required: true),
                            .init(id: "appleID", title: "Apple ID"),
                            .init(id: "contentRights", title: "Content Rights", required: true, isShared: true, kind: .choice(["Owns or has rights", "Uses third-party content", "Unsure"])),
                            .init(id: "primaryLanguage", title: "Primary Language", required: true, isShared: true, kind: .choice(languageOptions)),
                            .init(id: "primaryCategory", title: "Category - Primary", required: true, kind: .choice(categoryOptions)),
                            .init(id: "secondaryCategory", title: "Category - Secondary", kind: .choice(["None"] + categoryOptions)),
                            .init(id: "licenseAgreement", title: "License Agreement", isShared: true, kind: .choice(["Standard Apple License Agreement", "Custom License Agreement"]))
                        ]),
                        SubmissionSection(id: "ageRatings", title: "Age Ratings", fields: [
                            .init(id: "ageRatingNotes", title: "Age Rating Notes", placeholder: "Content, web access, UGC, ads, medical, gambling, etc.", kind: .longText)
                        ]),
                        SubmissionSection(id: "encryption", title: "App Encryption Documentation", fields: [
                            .init(id: "encryptionNotes", title: "Encryption Notes", kind: .longText)
                        ]),
                        SubmissionSection(id: "regulations", title: "App Store Regulations & Permits", fields: [
                            .init(id: "digitalServicesAct", title: "Digital Services Act", kind: .longText),
                            .init(id: "vietnamGameLicense", title: "Vietnam Game License", kind: .longText),
                            .init(id: "regulatedMedicalDevices", title: "Regulated Medical Devices", kind: .longText)
                        ]),
                        SubmissionSection(id: "sharedSecrets", title: "App-Specific Shared Secrets", fields: [
                            .init(id: "sharedSecrets", title: "Shared Secret Notes", kind: .longText)
                        ]),
                        SubmissionSection(id: "additionalInfo", title: "Additional Information", fields: [
                            .init(id: "additionalInformation", title: "Additional Information", kind: .longText)
                        ])
                    ]
                ),
                SubmissionSection(id: "appReview", title: "App Review", fields: [
                    .init(id: "appReviewStatus", title: "App Review Status")
                ]),
                SubmissionSection(id: "history", title: "History", fields: [
                    .init(id: "historyNotes", title: "History Notes", kind: .longText)
                ])
            ]
        ),
        SubmissionSection(
            id: "appStore",
            title: "App Store",
            fields: [],
            children: [
                SubmissionSection(id: "trustSafety", title: "Trust & Safety", fields: [], children: [
                    SubmissionSection(id: "appPrivacy", title: "App Privacy", fields: [
                        .init(id: "privacyStarted", title: "Get Started", kind: .checkbox),
                        .init(id: "privacyPolicyURL", title: "Privacy Policy URL", required: true, placeholder: "Public privacy policy URL that explains this app's data practices"),
                        .init(id: "privacyChoicesURL", title: "User Privacy Choices URL", placeholder: "Optional URL where users can manage privacy choices or data requests")
                    ]),
                    SubmissionSection(id: "accessibility", title: "App Accessibility", fields: [
                        .init(id: "accessibilityStarted", title: "Get Started", kind: .checkbox),
                        .init(id: "voiceOver", title: "VoiceOver", kind: .checkbox),
                        .init(id: "voiceControl", title: "Voice Control", kind: .checkbox),
                        .init(id: "largerText", title: "Larger Text", kind: .checkbox),
                        .init(id: "darkInterface", title: "Dark Interface", kind: .checkbox),
                        .init(id: "differentiateWithoutColor", title: "Differentiate Without Color Alone", kind: .checkbox),
                        .init(id: "sufficientContrast", title: "Sufficient Contrast", kind: .checkbox),
                        .init(id: "reducedMotion", title: "Reduced Motion", kind: .checkbox),
                        .init(id: "captions", title: "Captions", kind: .checkbox),
                        .init(id: "audioDescriptions", title: "Audio Descriptions", kind: .checkbox)
                    ]),
                    SubmissionSection(id: "ratingsReviews", title: "Ratings and Reviews", fields: [
                        .init(id: "ratingsReviewsNotes", title: "Ratings and Reviews Notes", kind: .longText)
                    ])
                ]),
                SubmissionSection(id: "growthMarketing", title: "Growth & Marketing", fields: [], children: [
                    SubmissionSection(id: "inAppEvents", title: "In-App Events", fields: [.init(id: "inAppEventsNotes", title: "In-App Events Notes", kind: .longText)]),
                    SubmissionSection(id: "customProductPages", title: "Custom Product Pages", fields: [.init(id: "customProductPage", title: "Create Custom Product Page", kind: .checkbox)]),
                    SubmissionSection(id: "productPageOptimization", title: "Product Page Optimization", fields: [.init(id: "createTest", title: "Create Test", kind: .checkbox)]),
                    SubmissionSection(id: "promoCodes", title: "Promo Codes", fields: [.init(id: "promoCodes", title: "Add Promo Codes after approved version", kind: .longText)]),
                    SubmissionSection(id: "gameCenter", title: "Game Center", fields: [.init(id: "gameCenterNotes", title: "Game Center Notes", kind: .longText)])
                ]),
                SubmissionSection(id: "monetization", title: "Monetization", fields: [], children: [
                    SubmissionSection(id: "pricingAvailability", title: "Pricing and Availability", fields: [
                        .init(id: "pricing", title: "Pricing", required: true, kind: .choice(["Free", "Paid tier selected in App Store Connect", "Unsure / needs pricing setup"])),
                        .init(id: "availability", title: "Availability", required: true, kind: .choice(["All countries or regions", "Selected countries or regions", "Unsure / needs availability setup"])),
                        .init(id: "taxCategory", title: "Tax Category"),
                        .init(id: "appleSiliconMac", title: "Make this app available on Apple silicon Macs", kind: .checkbox),
                        .init(id: "appleVisionPro", title: "Make this app available on Apple Vision Pro", kind: .checkbox),
                        .init(id: "distributionMethod", title: "App Distribution Methods", required: true, isShared: true, kind: .choice(["Public - Discoverable by anyone on the App Store", "Private - Custom app on Apple Business Manager or Apple School Manager"])),
                        .init(id: "schoolManagerReducedPrice", title: "Offer reduced price on Apple School Manager for volume purchases", kind: .checkbox)
                    ]),
                    SubmissionSection(id: "subscriptions", title: "Subscriptions", fields: [
                        .init(id: "subscriptionGroup", title: "Create a Subscription Group", kind: .checkbox),
                        .init(id: "billingGracePeriod", title: "Billing Grace Period", kind: .checkbox),
                        .init(id: "streamlinedPurchasing", title: "Streamlined Purchasing", kind: .checkbox),
                        .init(id: "nonRenewingSubscriptions", title: "Non-Renewing Subscriptions", kind: .checkbox)
                    ])
                ]),
                SubmissionSection(id: "featuring", title: "Featuring", fields: [
                    .init(id: "nominations", title: "Nominations", kind: .longText)
                ])
            ]
        )
    ]

    static var allFields: [SubmissionField] {
        sections.flatMap(\.allFields)
    }

    static var requiredFields: [SubmissionField] {
        allFields.filter(\.required)
    }

    static var sharedFields: [SubmissionField] {
        allFields.filter(\.isShared)
    }

    static var sharedFieldIDs: Set<String> {
        Set(sharedFields.map(\.id))
    }
}
