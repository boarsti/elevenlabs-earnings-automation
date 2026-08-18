import SwiftUI
import Charts

enum ChartRange: String, CaseIterable, Identifiable {
    case daily = "Tag", weekly = "Woche", monthly = "Monat"
    var id: String { rawValue }
}

struct DashboardView: View {
    @State private var data: EarningsData = .placeholder
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var range: ChartRange = .daily

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    header
                    kpiGrid
                    chartSection
                    if let errorMessage {
                        Text(errorMessage).font(.footnote).foregroundStyle(.red)
                    }
                }
                .padding()
            }
            .navigationTitle("Einnahmen")
            .refreshable { await load() }
            .task { await load() }
        }
    }

    private var header: some View {
        VStack(spacing: 4) {
            Text("Ablesezeit diese Woche: \(data.readoutTimeWeekly)")
                .font(.caption).foregroundStyle(.secondary)
            Text(data.sinceReadoutUsd, format: .currency(code: "USD"))
                .font(.system(size: 44, weight: .bold, design: .rounded))
                .contentTransition(.numericText())
            Text("seit gestern dieser Uhrzeit")
                .font(.caption).foregroundStyle(.secondary)
            if data.stale {
                Label("Daten veraltet", systemImage: "exclamationmark.triangle.fill")
                    .font(.caption).foregroundStyle(.orange)
            }
        }
    }

    private var kpiGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            KpiCard(title: "Current Period", value: data.currentPeriodUsd, currencyCode: "USD")
            KpiCard(title: "All-Time Payouts", value: data.allTimePayoutsEur, currencyCode: "EUR")
            KpiCard(
                title: "Diese Woche",
                value: data.history.weekly.last?.eur ?? 0,
                currencyCode: "EUR"
            )
            KpiCard(
                title: "Ø/Tag dieser Monat",
                value: data.history.monthly.last?.avgUsd ?? 0,
                currencyCode: "USD"
            )
        }
    }

    private var chartSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Zeitraum", selection: $range) {
                ForEach(ChartRange.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)

            Chart {
                switch range {
                case .daily:
                    ForEach(data.history.daily) { point in
                        LineMark(x: .value("Datum", point.date), y: .value("USD", point.usd))
                    }
                case .weekly:
                    ForEach(data.history.weekly) { point in
                        LineMark(x: .value("Woche", point.weekStart), y: .value("EUR", point.eur))
                    }
                case .monthly:
                    ForEach(data.history.monthly) { point in
                        BarMark(x: .value("Monat", point.month), y: .value("USD", point.usd))
                    }
                }
            }
            .frame(height: 220)
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 6)) }
        }
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            data = try await EarningsClient.fetch()
            errorMessage = nil
        } catch {
            errorMessage = "Konnte Daten nicht laden: \(error.localizedDescription)"
        }
    }
}

private struct KpiCard: View {
    let title: String
    let value: Double
    let currencyCode: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value, format: .currency(code: currencyCode))
                .font(.title2.bold())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

#Preview {
    DashboardView()
}
