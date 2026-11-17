import BelayCore
import os
import SwiftUI

/// « Saisies refusées », first in Réglages while the server has refused anything: each entry in
/// the web's words for its kind and day, the reason under it, the web's note, and « Effacer la
/// liste », which forgets them on this phone. A refusal is never silent (A5).
struct RefusedSection: View {
    let store: AccountStore
    let corps: CorpsModel
    @State private var entries: [RejectedEntry] = []

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "settings")

    var body: some View {
        Group {
            if !entries.isEmpty {
                Section {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(verbatim: describe(entry.change)).foregroundStyle(.ink)
                            Text(verbatim: reason(entry.reason)).font(.subheadline).foregroundStyle(.muted)
                        }
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("rejected-\(index)")
                    }
                    Button(action: clear) {
                        Text("Effacer la liste", tableName: "Reglages").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    }
                    .foregroundStyle(.ink)
                    .accessibilityIdentifier("rejected-clear")
                } header: {
                    Text("Saisies refusées", tableName: "Reglages")
                } footer: {
                    Text(
                        "Le serveur les a refusées\u{202F}: elles ne sont plus en attente. Saisis-les à nouveau si besoin.",
                        tableName: "Reglages")
                }
                .listRowBackground(Color.surface)
            }
        }
        .onAppear(perform: read)
    }

    private func read() {
        do {
            entries = try store.rejected()
        } catch {
            Self.log.error("refusals not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    private func clear() {
        do {
            try store.clearRejected()
            entries = []
        } catch {
            Self.log.error("refusals not cleared: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// « 17 novembre », a stored day as a sentence says it.
    private func day(_ iso: String) -> String {
        BodyText.date(iso)?.formatted(.dateTime.day().month(.wide)) ?? iso
    }

    /// The day an instant falls on, here.
    private func day(instant: String) -> String? {
        Instant.date(instant)?.formatted(.dateTime.day().month(.wide))
    }

    private func name(_ id: String) -> String {
        corps.supplementName(id) ?? String(localized: "Complément", table: "Reglages")
    }

    /// What the refused entry was, as the person entered it; the web's `settings.rejected.*`.
    private func describe(_ change: Change) -> String {
        switch change {
        case .weight(let c): return String(localized: "Pesée du \(day(c.date))", table: "Reglages")
        case .target: return String(localized: "Fourchette de perte", table: "Reglages")
        case .measure(let c):
            switch c.field {
            case .waist: return String(localized: "Tour de taille du \(day(c.date))", table: "Reglages")
            case .neck: return String(localized: "Tour de cou du \(day(c.date))", table: "Reglages")
            case .hip: return String(localized: "Tour de hanches du \(day(c.date))", table: "Reglages")
            }
        case .intake(let c): return String(localized: "Apports du \(day(c.date))", table: "Reglages")
        case .profile(let c):
            let field =
                switch c.edit {
                case .formula: String(localized: "formule", table: "Reglages")
                case .birthYear: String(localized: "année de naissance", table: "Reglages")
                case .height: String(localized: "taille", table: "Reglages")
                }
            return String(localized: "Profil\u{202F}: \(field)", table: "Reglages")
        case .supplement(let c):
            let shown: String
            if case .name(let name) = c.edit { shown = name } else { shown = name(c.id) }
            return String(localized: "Complément\u{202F}: \(shown)", table: "Reglages")
        case .supplementLog(let c):
            return String(localized: "\(name(c.supplementId)) (coche du \(day(c.date)))", table: "Reglages")
        case .annotation(let c):
            let date: String? =
                if case .fields(let date, _, _) = c.edit { date } else { corps.annotations.first { $0.id == c.id }?.date }
            guard let date else { return String(localized: "Annotation", table: "Reglages") }
            return String(localized: "Annotation du \(day(date))", table: "Reglages")
        case .steps(let c): return String(localized: "Pas du \(day(c.date))", table: "Reglages")
        case .activity(let c):
            guard case .fields(let date, _) = c.edit else { return String(localized: "Activité", table: "Reglages") }
            return String(localized: "Activité du \(day(date))", table: "Reglages")
        case .workout(let c):
            guard case .start(let start) = c.edit, let shown = day(instant: start.startedAt) else {
                return String(localized: "Séance", table: "Reglages")
            }
            return String(localized: "Séance du \(shown)", table: "Reglages")
        case .set(let c):
            guard case .create(let create) = c.edit, let shown = day(instant: create.doneAt) else {
                return String(localized: "Série", table: "Reglages")
            }
            return String(localized: "Série du \(shown)", table: "Reglages")
        case .activeProgram: return String(localized: "Programme", table: "Reglages")
        }
    }

    /// The server's reason in the web's words; one it has not named reads as refused.
    private func reason(_ code: String) -> String {
        switch code {
        case "unknown": String(localized: "Introuvable sur le serveur", table: "Reglages")
        case "unknown_exercise": String(localized: "Exercice inconnu du serveur", table: "Reglages")
        case "too_many_sets": String(localized: "Plus de 150 séries dans la séance", table: "Reglages")
        case "wrong_measure":
            String(localized: "Compté en répétitions pour un exercice chronométré, ou l’inverse", table: "Reglages")
        case "plan_shrank":
            String(
                localized: "Moins d’exercices que la séance enregistrée (un exercice n’est jamais retiré)",
                table: "Reglages")
        default: String(localized: "Refusée par le serveur", table: "Reglages")
        }
    }
}
