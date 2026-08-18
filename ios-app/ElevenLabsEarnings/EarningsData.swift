import Foundation

/// Spiegelt das JSON aus apps-script/Code.gs (siehe Design-Doku, Abschnitt "Datenbrücke").
/// Wird in BEIDEN Targets gebraucht (App + Widget) - siehe README, Schritt 4.
/// Feldnamen 1:1 zum HTML-Dashboard (html-dashboard/index.html) - Stand 18.08.2026.
struct EarningsData: Codable {
    let readoutTimeWeekly: String
    let sinceYesterdayUsd: Double
    let sinceLabelKind: String // "heute" | "gestern" | "datum"
    let sinceReferenceDate: String?
    let thisWeekUsdNet: Double
    let avgDailyUsd: Double? // null am Rollover-Tag selbst (siehe Code.gs)
    let thisWeekEur: Double
    let lastWeekEurDirect: Double?
    let thisWeekVsLastWeekPct: Double?
    let lastWeekUsdSameOffset: Double?
    let lastWeekAvgDailyUsd: Double?
    let thisYearEur: Double
    let lastYearEurSamePeriod: Double?
    let fxRateUsdEur: Double
    let thisMonthEur: Double
    let lastMonthEur: Double?
    let currentPeriodUsd: Double
    let currentPeriodCurrency: String
    let lastUpdated: String
    let stale: Bool
    let history: History

    struct History: Codable {
        let daily: [DailyPoint]
        let weekly: [WeeklyPoint]
        let monthly: [MonthlyPoint]
        let yearly: [YearlyPoint]
        let intraday: [IntradayPoint]
    }

    struct DailyPoint: Codable, Identifiable {
        let date: String
        let usd: Double
        var id: String { date }
    }

    struct WeeklyPoint: Codable, Identifiable {
        let weekStart: String
        let eur: Double
        let status: String?
        let avgPerDayEur: Double?
        var id: String { weekStart }
    }

    struct MonthlyPoint: Codable, Identifiable {
        let month: String
        let eur: Double
        let avgEur: Double
        var id: String { month }
    }

    struct YearlyPoint: Codable, Identifiable {
        let year: String
        let eur: Double
        let avgEur: Double
        var id: String { year }
    }

    struct IntradayPoint: Codable, Identifiable {
        let ts: String
        let usd: Double?
        var id: String { ts }
    }

    static let placeholder = EarningsData(
        readoutTimeWeekly: "",
        sinceYesterdayUsd: 0,
        sinceLabelKind: "gestern",
        sinceReferenceDate: nil,
        thisWeekUsdNet: 0,
        avgDailyUsd: nil,
        thisWeekEur: 0,
        lastWeekEurDirect: nil,
        thisWeekVsLastWeekPct: nil,
        lastWeekUsdSameOffset: nil,
        lastWeekAvgDailyUsd: nil,
        thisYearEur: 0,
        lastYearEurSamePeriod: nil,
        fxRateUsdEur: 0,
        thisMonthEur: 0,
        lastMonthEur: nil,
        currentPeriodUsd: 0,
        currentPeriodCurrency: "USD",
        lastUpdated: "",
        stale: true,
        history: History(daily: [], weekly: [], monthly: [], yearly: [], intraday: [])
    )
}

/// Parst einen ISO-Zeitstempel (z.B. "2026-08-18T11:59:00.000Z") robust - mit und ohne
/// Sekundenbruchteile.
func parseIso(_ iso: String) -> Date? {
    guard !iso.isEmpty else { return nil }
    let f1 = ISO8601DateFormatter()
    f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f1.date(from: iso) { return d }
    let f2 = ISO8601DateFormatter()
    f2.formatOptions = [.withInternetDateTime]
    return f2.date(from: iso)
}

/// Formatiert einen ISO-Zeitstempel als deutsches Datum+Uhrzeit ("18.08.2026, 13:59").
/// Fällt auf den Rohwert zurück, wenn das Parsen fehlschlägt.
func formatReadoutDateTime(_ iso: String) -> String {
    guard let date = parseIso(iso) else { return iso.isEmpty ? "—" : iso }
    let out = DateFormatter()
    out.locale = Locale(identifier: "de_DE")
    out.dateFormat = "dd.MM.yyyy, HH:mm"
    return out.string(from: date)
}

/// Label fuer die erste Headline-Karte ("Seit heute, 11:59" / "Seit gestern, 11:59" /
/// "Seit 15.08., 11:59") - spiegelt fmtSinceLabel() im HTML-Dashboard 1:1.
func sinceLabel(_ data: EarningsData) -> String {
    let timePart: String
    if let d = parseIso(data.readoutTimeWeekly) {
        let f = DateFormatter()
        f.locale = Locale(identifier: "de_DE")
        f.dateFormat = "HH:mm"
        timePart = f.string(from: d)
    } else {
        timePart = ""
    }
    switch data.sinceLabelKind {
    case "heute": return "Seit heute, \(timePart)"
    case "gestern": return "Seit gestern, \(timePart)"
    default:
        guard let ref = data.sinceReferenceDate else { return "Seit gestern, \(timePart)" }
        let inFmt = DateFormatter()
        inFmt.dateFormat = "yyyy-MM-dd"
        inFmt.timeZone = TimeZone(identifier: "Europe/Berlin")
        guard let refDate = inFmt.date(from: ref) else { return "Seit gestern, \(timePart)" }
        let outFmt = DateFormatter()
        outFmt.locale = Locale(identifier: "de_DE")
        outFmt.dateFormat = "dd.MM."
        return "Seit \(outFmt.string(from: refDate)), \(timePart)"
    }
}
