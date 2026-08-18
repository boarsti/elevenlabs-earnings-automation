import SwiftUI

/// Tab 1 "Heute": die wichtigsten Headline-Werte, kompakt und ohne langes Scrollen -
/// orientiert an der Referenz (Home-Assistant-Dashboard: grosse Hero-Karte oben,
/// darunter kompakte Vergleichszeilen mit farbigen Delta-Pillen statt einer langen
/// Tabelle).
struct OverviewView: View {
    let data: EarningsData

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                if data.stale {
                    Label("Daten veraltet", systemImage: "exclamationmark.triangle.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Brand.amberDeep)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                }

                heroCard

                HStack(spacing: 12) {
                    compactCard(title: "Diese Woche", value: fmtUsd(data.thisWeekUsdNet)) {
                        CompareLine(label: "Vorwoche", value: data.lastWeekUsdSameOffset.map(fmtUsd))
                    }
                    compactCard(title: "Ø pro Tag", value: fmtUsd(data.avgDailyUsd)) {
                        CompareLine(label: "Vorwoche", value: data.lastWeekAvgDailyUsd.map(fmtUsd))
                    }
                }

                VStack(spacing: 10) {
                    euroRow(
                        icon: "eurosign.circle.fill",
                        title: "EUR / letzte Abrechnung",
                        value: fmtEur(data.thisWeekEur),
                        pill: data.thisWeekVsLastWeekPct,
                        compareLabel: "Vorwoche",
                        compareValue: data.lastWeekEurDirect.map(fmtEur)
                    )
                    Divider().overlay(Color.white.opacity(0.08))
                    euroRow(
                        icon: "calendar",
                        title: "Dieser Monat (EUR)",
                        value: fmtEur(data.thisMonthEur),
                        pill: nil,
                        compareLabel: "Vormonat",
                        compareValue: data.lastMonthEur.map(fmtEur)
                    )
                    Divider().overlay(Color.white.opacity(0.08))
                    euroRow(
                        icon: "chart.line.uptrend.xyaxis",
                        title: "Dieses Jahr (EUR)",
                        value: fmtEur(data.thisYearEur),
                        pill: nil,
                        compareLabel: "Vorjahr (bis hierhin)",
                        compareValue: data.lastYearEurSamePeriod.map(fmtEur)
                    )
                }
                .padding(16)
                .background(Brand.ink2, in: RoundedRectangle(cornerRadius: 16))

                if data.fxRateUsdEur > 0 {
                    Text("Kurs: 1 USD ≈ \(data.fxRateUsdEur, specifier: "%.4f") EUR")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .padding()
        }
        .background(Brand.ink.ignoresSafeArea())
    }

    private var heroCard: some View {
        VStack(spacing: 6) {
            Text(sinceLabel(data))
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(fmtUsd(data.sinceYesterdayUsd))
                .font(.system(size: 48, weight: .heavy, design: .rounded))
                .foregroundStyle(.white)
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(Brand.ink2, in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private func compactCard(title: String, value: String, @ViewBuilder compare: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value)
                .font(.title2.weight(.bold))
                .foregroundStyle(.white)
            compare()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Brand.ink2, in: RoundedRectangle(cornerRadius: 16))
    }

    private func euroRow(icon: String, title: String, value: String, pill: Double?, compareLabel: String, compareValue: String?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Brand.amber)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(value).font(.headline).foregroundStyle(.white)
                    DeltaPill(percent: pill)
                }
                CompareLine(label: compareLabel, value: compareValue)
            }
            Spacer()
        }
    }
}

#Preview {
    OverviewView(data: .placeholder)
}
