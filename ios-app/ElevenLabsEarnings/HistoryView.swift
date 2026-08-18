import SwiftUI
import Charts

/// Tab 2 "Verlauf": Segment-Picker + Gradient-Flaechenchart, orientiert an der
/// Referenz (Home-Assistant-Dashboard: orange Ist-Linie mit Gradient-Fuellung, duenne
/// gestrichelte Vergleichslinie fuer die Vorperiode).
struct HistoryView: View {
    let data: EarningsData
    @State private var range: ChartRange = .daily

    private static let dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
    private static let monthNames = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"]

    private func rangeLabel(_ r: ChartRange) -> String {
        let now = Date()
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Berlin")!
        switch r {
        case .daily:
            let wd = cal.component(.weekday, from: now) - 1
            let day = cal.component(.day, from: now)
            let month = cal.component(.month, from: now)
            return "\(Self.dayNames[wd]) \(String(format: "%02d", day)).\(String(format: "%02d", month))."
        case .weekly:
            let week = cal.component(.weekOfYear, from: now)
            return "KW\(week)"
        case .monthly:
            return Self.monthNames[cal.component(.month, from: now) - 1]
        case .yearly:
            return String(cal.component(.year, from: now))
        case .total:
            return "Gesamt"
        }
    }

    private var series: CompareSeries? {
        switch range {
        case .daily: return buildDayCompare(intraday: data.history.intraday, readoutTimeWeeklyIso: data.readoutTimeWeekly)
        case .weekly: return buildWeekCompare(daily: data.history.daily)
        case .monthly: return buildMonthCompare(daily: data.history.daily)
        case .yearly: return buildYearCompare(monthly: data.history.monthly)
        case .total: return nil
        }
    }

    private var points: [ComparePoint] {
        range == .total ? totalSeries(weekly: data.history.weekly) : (series?.points ?? [])
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(ChartRange.allCases) { r in
                            Button(rangeLabel(r)) { range = r }
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 14)
                                .padding(.vertical, 8)
                                .background(range == r ? Brand.amber : Brand.ink2, in: Capsule())
                                .foregroundStyle(range == r ? .white : .secondary)
                        }
                    }
                }

                if let s = series, range != .total {
                    HStack(spacing: 16) {
                        legendDot(color: Brand.amber, label: s.thisLabel)
                        legendDot(color: Brand.blue, label: s.lastLabel)
                    }
                    .font(.caption2)
                }

                chart
                    .frame(height: 260)
                    .padding(16)
                    .background(Brand.ink2, in: RoundedRectangle(cornerRadius: 16))
            }
            .padding()
        }
        .background(Brand.ink.ignoresSafeArea())
    }

    private var chart: some View {
        Chart {
            ForEach(points) { p in
                if let v = p.thisValue {
                    AreaMark(x: .value("x", p.label), y: .value("Wert", v))
                        .foregroundStyle(
                            .linearGradient(colors: [Brand.amber.opacity(0.35), Brand.amber.opacity(0)], startPoint: .top, endPoint: .bottom)
                        )
                        .interpolationMethod(.catmullRom)
                    LineMark(x: .value("x", p.label), y: .value("Wert", v))
                        .foregroundStyle(Brand.amber)
                        .lineStyle(StrokeStyle(lineWidth: 2.5))
                        .interpolationMethod(.catmullRom)
                }
            }
            if range != .total {
                ForEach(points) { p in
                    if let v = p.lastValue {
                        LineMark(x: .value("x", p.label), y: .value("Vorperiode", v))
                            .foregroundStyle(Brand.blue)
                            .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [4, 3]))
                            .interpolationMethod(.catmullRom)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 6)) { _ in
                AxisGridLine().foregroundStyle(Color.white.opacity(0.15))
                AxisValueLabel().foregroundStyle(Color.white.opacity(0.6))
            }
        }
        .chartYAxis {
            AxisMarks { _ in
                AxisGridLine().foregroundStyle(Color.white.opacity(0.15))
                AxisValueLabel().foregroundStyle(Color.white.opacity(0.6))
            }
        }
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).foregroundStyle(.secondary)
        }
    }
}

#Preview {
    HistoryView(data: .placeholder)
}
