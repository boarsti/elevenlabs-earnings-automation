import Foundation

/// Portiert 1:1 die Vergleichs-Logik aus html-dashboard/index.html (buildDayCompare /
/// buildWeekCompare / buildMonthCompare / buildYearCompare), damit App und HTML-
/// Dashboard exakt dieselben Werte zeigen (Nutzer-Anforderung: "vollwertig das
/// gleiche koennen").
struct ComparePoint: Identifiable {
    let id: Int
    let label: String
    let thisValue: Double?
    let lastValue: Double?
}

struct CompareSeries {
    let points: [ComparePoint]
    let thisLabel: String
    let lastLabel: String
}

enum ChartRange: String, CaseIterable, Identifiable {
    case daily, weekly, monthly, yearly, total
    var id: String { rawValue }
}

/// "Tag": 24h-Fenster ab der woechentlichen Ablesezeit (nicht Mitternacht) - siehe
/// Nutzer-Feedback 18.08.2026 ("heute ab 11:59 bis morgen 11:58 sind 24h").
func buildDayCompare(intraday: [EarningsData.IntradayPoint], readoutTimeWeeklyIso: String) -> CompareSeries? {
    guard let anchor = parseIso(readoutTimeWeeklyIso) else { return nil }
    let dayMs: TimeInterval = 24 * 60 * 60
    let now = Date()
    let windowsElapsed = floor(now.timeIntervalSince(anchor) / dayMs)
    let windowStart = anchor.addingTimeInterval(windowsElapsed * dayMs)
    let prevWindowStart = windowStart.addingTimeInterval(-dayMs)

    func pointsIn(_ start: Date) -> [EarningsData.IntradayPoint] {
        intraday.filter {
            guard let t = parseIso($0.ts) else { return false }
            return t >= start && t < start.addingTimeInterval(dayMs)
        }
    }
    let thisWindow = pointsIn(windowStart)
    let lastWindow = pointsIn(prevWindowStart)

    let timeFmt = DateFormatter()
    timeFmt.locale = Locale(identifier: "de_DE")
    timeFmt.dateFormat = "HH:mm"

    func bucket(_ pts: [EarningsData.IntradayPoint], start: Date) -> [Double?] {
        var arr = [Double?](repeating: nil, count: 25)
        for p in pts {
            guard let t = parseIso(p.ts) else { continue }
            let h = Int((t.timeIntervalSince(start) / 3600).rounded())
            if h >= 0, h <= 24 { arr[h] = p.usd }
        }
        return arr
    }
    let thisValues = bucket(thisWindow, start: windowStart)
    let lastValues = lastWindow.isEmpty ? [Double?](repeating: nil, count: 25) : bucket(lastWindow, start: prevWindowStart)
    let hasLast = !lastWindow.isEmpty

    let labels = (0...24).map { h in timeFmt.string(from: windowStart.addingTimeInterval(Double(h) * 3600)) }
    let points = (0..<25).map { i in
        ComparePoint(id: i, label: labels[i], thisValue: thisValues[i], lastValue: hasLast ? lastValues[i] : nil)
    }
    return CompareSeries(points: points, thisLabel: "Heute (ab Ablesezeit)", lastLabel: "Vortag (gleicher Zeitraum)")
}

/// Montag-verankerter ISO-Wochenschluessel.
private func isoWeekKey(_ dateStr: String) -> String? {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone(identifier: "UTC")
    guard let d = fmt.date(from: dateStr) else { return nil }
    let weekday = cal.component(.weekday, from: d) // 1=So...7=Sa
    let dayOffset = (weekday + 5) % 7 // Mo=0...So=6
    guard let monday = cal.date(byAdding: .day, value: -dayOffset, to: d) else { return nil }
    return fmt.string(from: monday)
}

func buildWeekCompare(daily: [EarningsData.DailyPoint]) -> CompareSeries? {
    var byWeek: [String: [EarningsData.DailyPoint]] = [:]
    for p in daily {
        guard let wk = isoWeekKey(p.date) else { continue }
        byWeek[wk, default: []].append(p)
    }
    let weekKeys = byWeek.keys.sorted()
    guard weekKeys.count >= 2 else { return nil }
    let thisWeek = byWeek[weekKeys[weekKeys.count - 1]] ?? []
    let lastWeek = byWeek[weekKeys[weekKeys.count - 2]] ?? []
    let dayNames = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone(identifier: "UTC")
    guard let mondayDate = fmt.date(from: weekKeys[weekKeys.count - 1]) else { return nil }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!

    let points = (0..<7).map { i -> ComparePoint in
        let d = cal.date(byAdding: .day, value: i, to: mondayDate) ?? mondayDate
        let dayNum = cal.component(.day, from: d)
        let monthNum = cal.component(.month, from: d)
        let label = "\(dayNames[i]) \(String(format: "%02d", dayNum)).\(String(format: "%02d", monthNum))."
        return ComparePoint(
            id: i,
            label: label,
            thisValue: i < thisWeek.count ? thisWeek[i].usd : nil,
            lastValue: i < lastWeek.count ? lastWeek[i].usd : nil
        )
    }
    return CompareSeries(points: points, thisLabel: "Diese Woche", lastLabel: "Vorwoche")
}

func buildMonthCompare(daily: [EarningsData.DailyPoint]) -> CompareSeries? {
    var byMonth: [String: [EarningsData.DailyPoint]] = [:]
    for p in daily {
        let mk = String(p.date.prefix(7))
        byMonth[mk, default: []].append(p)
    }
    let monthKeys = byMonth.keys.sorted()
    guard monthKeys.count >= 2 else { return nil }
    let thisMonthKey = monthKeys[monthKeys.count - 1]
    let thisMonth = byMonth[thisMonthKey] ?? []
    let lastMonth = byMonth[monthKeys[monthKeys.count - 2]] ?? []
    let maxLen = max(thisMonth.count, lastMonth.count, 28)
    let dayNames = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone(identifier: "UTC")
    guard let firstOfMonth = fmt.date(from: "\(thisMonthKey)-01") else { return nil }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!

    let points = (0..<maxLen).map { i -> ComparePoint in
        let d = cal.date(byAdding: .day, value: i, to: firstOfMonth) ?? firstOfMonth
        let weekday = cal.component(.weekday, from: d) - 1 // 0=So
        let label = "\(dayNames[weekday]) \(i + 1)."
        return ComparePoint(
            id: i,
            label: label,
            thisValue: i < thisMonth.count ? thisMonth[i].usd : nil,
            lastValue: i < lastMonth.count ? lastMonth[i].usd : nil
        )
    }
    return CompareSeries(points: points, thisLabel: "Dieser Monat", lastLabel: "Vormonat")
}

func buildYearCompare(monthly: [EarningsData.MonthlyPoint]) -> CompareSeries? {
    var byYear: [String: [Int: Double]] = [:]
    for m in monthly {
        let parts = m.month.split(separator: "-")
        guard parts.count == 2, let mm = Int(parts[1]) else { continue }
        let y = String(parts[0])
        byYear[y, default: [:]][mm] = m.eur
    }
    let years = byYear.keys.sorted()
    guard years.count >= 2 else { return nil }
    let thisYear = years[years.count - 1]
    let lastYear = years[years.count - 2]
    let monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"]

    let points = (0..<12).map { i in
        ComparePoint(
            id: i,
            label: monthNames[i],
            thisValue: byYear[thisYear]?[i + 1],
            lastValue: byYear[lastYear]?[i + 1]
        )
    }
    return CompareSeries(points: points, thisLabel: thisYear, lastLabel: lastYear)
}

/// "Gesamt": voller Verlauf seit Aufzeichnungsbeginn, ohne Vergleichslinie. Monatsmarken
/// ("04.2025") statt Einzeldaten.
func totalSeries(weekly: [EarningsData.WeeklyPoint]) -> [ComparePoint] {
    weekly.enumerated().map { i, w in
        let iso = w.weekStart
        let label = iso.count >= 7 ? "\(iso.prefix(7).suffix(2)).\(iso.prefix(4))" : ""
        return ComparePoint(id: i, label: label, thisValue: w.eur, lastValue: nil)
    }
}
