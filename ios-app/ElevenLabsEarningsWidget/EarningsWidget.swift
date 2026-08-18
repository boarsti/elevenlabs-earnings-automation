import WidgetKit
import SwiftUI

struct EarningsEntry: TimelineEntry {
    let date: Date
    let data: EarningsData
}

struct EarningsTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> EarningsEntry {
        EarningsEntry(date: Date(), data: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (EarningsEntry) -> Void) {
        completion(EarningsEntry(date: Date(), data: .placeholder))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<EarningsEntry>) -> Void) {
        Task {
            let data = (try? await EarningsClient.fetch()) ?? .placeholder
            let entry = EarningsEntry(date: Date(), data: data)
            // System-Budget entscheidet über die tatsaechliche Frequenz (siehe Design-Doku,
            // "iOS-Widget-Aktualität"). Wir fragen hoeflich alle 15 Minuten neu an.
            let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }
}

/// Zeigt exakt die 2 vom Nutzer geforderten Werte: die woechentliche Ablesezeit
/// (statisch pro Woche) und den Wert seit "gestern dieser Uhrzeit" - Feldnamen und
/// Label-Logik 1:1 zum HTML-Dashboard (sinceYesterdayUsd / sinceLabel()).
struct EarningsWidgetView: View {
    var entry: EarningsEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(formatReadoutDateTime(entry.data.readoutTimeWeekly))
                .font(.caption).opacity(0.85)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Spacer()
            Text(fmtUsd(entry.data.sinceYesterdayUsd))
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(sinceLabel(entry.data))
                .font(.caption2).opacity(0.7)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .foregroundStyle(.white)
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [Brand.ink, Brand.ink2],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        }
    }
}

struct EarningsWidget: Widget {
    let kind = "EarningsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: EarningsTimelineProvider()) { entry in
            EarningsWidgetView(entry: entry)
        }
        .configurationDisplayName("ElevenLabs Einnahmen")
        .description("Wochen-Ablesezeit und Wert seit gestern dieser Uhrzeit.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
