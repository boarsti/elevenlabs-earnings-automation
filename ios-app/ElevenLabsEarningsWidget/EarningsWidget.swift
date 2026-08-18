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

struct EarningsWidgetView: View {
    var entry: EarningsEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.data.readoutTimeWeekly.isEmpty ? "—" : entry.data.readoutTimeWeekly)
                .font(.caption).opacity(0.85)
            Spacer()
            Text(entry.data.sinceReadoutUsd, format: .currency(code: "USD"))
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text("seit gestern")
                .font(.caption2).opacity(0.7)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .foregroundStyle(.white)
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [Color(red: 0.10, green: 0.13, blue: 0.35), Color(red: 0.20, green: 0.05, blue: 0.45)],
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
