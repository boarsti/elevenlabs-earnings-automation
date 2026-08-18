import Foundation

/// Spiegelt das JSON aus apps-script/Code.gs (siehe Design-Doku, Abschnitt "Datenbrücke").
/// Wird in BEIDEN Targets gebraucht (App + Widget) - siehe README, Schritt 4.
struct EarningsData: Codable {
    let readoutTimeWeekly: String
    let sinceReadoutUsd: Double
    let currentPeriodUsd: Double
    let currentPeriodCurrency: String
    let allTimePayoutsEur: Double
    let lastUpdated: String
    let stale: Bool
    let history: History

    struct History: Codable {
        let daily: [DailyPoint]
        let weekly: [WeeklyPoint]
        let monthly: [MonthlyPoint]
    }

    struct DailyPoint: Codable, Identifiable {
        let date: String
        let usd: Double
        var id: String { date }
    }

    struct WeeklyPoint: Codable, Identifiable {
        let weekStart: String
        let eur: Double
        var id: String { weekStart }
    }

    struct MonthlyPoint: Codable, Identifiable {
        let month: String
        let usd: Double
        let avgUsd: Double
        var id: String { month }
    }

    static let placeholder = EarningsData(
        readoutTimeWeekly: "—",
        sinceReadoutUsd: 0,
        currentPeriodUsd: 0,
        currentPeriodCurrency: "USD",
        allTimePayoutsEur: 0,
        lastUpdated: "",
        stale: true,
        history: History(daily: [], weekly: [], monthly: [])
    )
}
