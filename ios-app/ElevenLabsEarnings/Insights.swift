import Foundation
import SwiftUI

/// Portiert 1:1 die "Insights"-Logik aus html-dashboard/index.html (Rekorde, Prognose,
/// Muster-Erkennung, Trend-Farbcodierung), damit App und HTML-Dashboard exakt dieselben
/// Werte und Hinweise zeigen.

// MARK: - Trend-Farbcodierung

/// Farbschema "heiss/kalt" (Orange=Anstieg, Blau=Rueckgang) - fest im Design verankert
/// (Nutzer-Anforderung 21.08.2026: "Ein Anstieg ist heiss = orange, ein Abstieg ist
/// blau = kalt. Bitte im Design fest verankern!!" - eine kurze Zwischenversion hatte
/// stattdessen Gruen/Amber-Deep genutzt, das war falsch). Identisch zum HTML-Dashboard
/// (TREND_UP_COLOR / TREND_DOWN_COLOR).
func trendColor(_ value: Double?) -> Color? {
    guard let value else { return nil }
    return value >= 0 ? Brand.amber : Brand.blue
}

// MARK: - ISO-Kalenderwoche

let berlinTZ = TimeZone(identifier: "Europe/Berlin")!

func isoWeekNumber(_ date: Date) -> Int {
    var cal = Calendar(identifier: .iso8601)
    cal.timeZone = berlinTZ
    return cal.component(.weekOfYear, from: date)
}

/// ISO-Wochenschluessel ("2025-W34") inkl. korrektem ISO-Wochenjahr (kann an
/// Jahresgrenzen vom Kalenderjahr abweichen) - fuer den exakten "gleiche KW,
/// Vorjahr"-Vergleich in der Auszahlungsliste.
func isoWeekYearKey(_ date: Date) -> String {
    var cal = Calendar(identifier: .iso8601)
    cal.timeZone = berlinTZ
    let year = cal.component(.yearForWeekOfYear, from: date)
    let week = cal.component(.weekOfYear, from: date)
    return "\(year)-W\(String(format: "%02d", week))"
}

// MARK: - Langzeit-Durchschnitte

/// Durchschnittlicher Tagesumsatz (USD) ueber die letzten "days" Tage (Nutzer-
/// Anforderung 21.08.2026: "Ø/Tag letzte 3 Monate"/"Ø/Tag 12 Monate" in Feld3,
/// App-Sync mit dem HTML-Dashboard computeAvgDailyOverDays()).
func computeAvgDailyOverDays(_ daily: [EarningsData.DailyPoint], days: Int) -> Double? {
    let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: Date()) ?? Date()
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(identifier: "Europe/Berlin")
    let cutoffIso = formatter.string(from: cutoff)
    let vals = daily.compactMap { $0.date >= cutoffIso ? $0.tagesumsatzUsd : nil }
    guard !vals.isEmpty else { return nil }
    return vals.reduce(0, +) / Double(vals.count)
}

// MARK: - Rekorde

struct Records {
    let bestDay: EarningsData.DailyPoint?
    let bestWeek: EarningsData.WeeklyPoint?
}

/// "Bestwert"-Rekorde ueber die volle Historie.
func computeRecords(_ data: EarningsData) -> Records {
    var bestDay: EarningsData.DailyPoint?
    for d in data.history.daily {
        guard let t = d.tagesumsatzUsd else { continue }
        if bestDay == nil || t > (bestDay?.tagesumsatzUsd ?? -.infinity) { bestDay = d }
    }
    var bestWeek: EarningsData.WeeklyPoint?
    for w in data.history.weekly {
        if bestWeek == nil || w.eur > (bestWeek?.eur ?? -.infinity) { bestWeek = w }
    }
    return Records(bestDay: bestDay, bestWeek: bestWeek)
}

// MARK: - Wochentag-Durchschnitt + Prognose

private func parseUtcDay(_ dateStr: String) -> Date? {
    let fmt = DateFormatter()
    fmt.dateFormat = "yyyy-MM-dd"
    fmt.timeZone = TimeZone(identifier: "UTC")
    return fmt.date(from: dateStr)
}

/// Durchschnitt TagesumsatzUSD je Wochentag (1=So...7=Sa, Calendar-Konvention) -
/// gemeinsam genutzt vom Wochentag-Muster-Hinweis und der Prognose.
func computeWeekdayAverages(_ daily: [EarningsData.DailyPoint]) -> (avgs: [Int: Double], total: Int) {
    var sums = [Int: Double]()
    var counts = [Int: Int]()
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = TimeZone(identifier: "UTC")!
    var total = 0
    for d in daily {
        guard let t = d.tagesumsatzUsd, let date = parseUtcDay(d.date) else { continue }
        let wd = cal.component(.weekday, from: date)
        sums[wd, default: 0] += t
        counts[wd, default: 0] += 1
        total += 1
    }
    var avgs = [Int: Double]()
    for (wd, sum) in sums {
        avgs[wd] = sum / Double(counts[wd] ?? 1)
    }
    return (avgs, total)
}

private func berlinWeekday(_ date: Date) -> Int {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = berlinTZ
    return cal.component(.weekday, from: date)
}

/// Prognose bis zum voraussichtlichen naechsten Ablesezeitpunkt: wochentag-bewusst
/// statt pauschalem Tagesschnitt (z.B. wenn Wochenenden bekanntlich schwaecher sind).
/// Faellt auf den einfachen Tagesschnitt zurueck, wenn fuer einen Wochentag noch keine
/// eigene Historie vorliegt.
///
/// Wochenende-Annahme ersetzt (Nutzer-Anforderung 21.08.2026, App-Sync mit dem HTML-
/// Dashboard): frueher wurde starr readout + 7 Tage angenommen - das ist seit der
/// Systemumstellung bei ElevenLabs (ca. 07.03.2026) spuerbar ungenau. Nutzt jetzt
/// data.nextReadoutEstimateIso (von estimateNextReadout() in Code.gs, aus den letzten
/// 10 Auszahlungsabstaenden berechnet), faellt auf die alte +7-Tage-Annahme zurueck,
/// falls die Schaetzung (noch) nicht verfuegbar ist.
func computeWeekProjection(_ data: EarningsData) -> Double? {
    guard let readout = parseIso(data.readoutTimeWeekly) else { return nil }
    let dayMs: TimeInterval = 24 * 60 * 60
    let weekEnd = data.nextReadoutEstimateIso.flatMap(parseIso) ?? readout.addingTimeInterval(7 * dayMs)
    let daysRemaining = weekEnd.timeIntervalSince(Date()) / dayMs
    guard daysRemaining > 0 else { return nil }

    let (avgs, _) = computeWeekdayAverages(data.history.daily)
    let fallback = data.avgDailyUsd ?? 0

    var sumEstimate = 0.0
    let fullDays = Int(daysRemaining)
    let fraction = daysRemaining - Double(fullDays)
    let now = Date()
    for i in 0..<fullDays {
        let wd = berlinWeekday(now.addingTimeInterval(Double(i + 1) * dayMs))
        sumEstimate += avgs[wd] ?? fallback
    }
    if fraction > 0 {
        let wd = berlinWeekday(now.addingTimeInterval(Double(fullDays + 1) * dayMs))
        sumEstimate += (avgs[wd] ?? fallback) * fraction
    }
    return data.thisWeekUsdNet + sumEstimate
}

/// Rechenbasis fuer "Ø pro Tag" als Text ("berechnet aus 2T 5Std") - identisch zum
/// HTML-Dashboard (Nutzer-Feedback 20.08.2026), damit der Kartenwert nicht wie ein
/// fixer Tagesschnitt wirkt, sondern erkennbar ist, wie wenig/viel Historie bereits
/// in die aktuelle Woche eingeflossen ist.
func avgDailyBasisLabel(_ data: EarningsData) -> String? {
    guard let readout = parseIso(data.readoutTimeWeekly) else { return nil }
    let elapsed = Date().timeIntervalSince(readout)
    guard elapsed > 0 else { return nil }
    let days = Int(elapsed / 86400)
    let hours = Int((elapsed.truncatingRemainder(dividingBy: 86400)) / 3600)
    return "berechnet aus \(days)T \(hours)Std"
}

// MARK: - "Seit gestern" vs. Ø letzte gleiche Wochentage

struct DayVsRecentSameWeekday {
    let pct: Double
    let count: Int
    let weekdayLabel: String
}

private let recentSameWeekdayCount = 8

/// Vergleich des aktuellen 24h-Fensters ("Seit gestern") mit dem Durchschnitt der
/// letzten 8 Tagesumsaetze am GLEICHEN Wochentag - ersetzt den frueheren Vergleich
/// gegen einen einzelnen Tag vor genau 364 Tagen (Nutzer-Feedback 21.08.2026, App-Sync
/// mit dem HTML-Dashboard: ein einzelner Tag gegen einen einzelnen Tag vor einem Jahr
/// ist zu verrauscht - Ø ueber die letzten 8 Vorkommen desselben Wochentags glaettet
/// das, bleibt aber wochentags-synchron).
func computeDayVsRecentSameWeekday(_ data: EarningsData) -> DayVsRecentSameWeekday? {
    guard !data.history.daily.isEmpty else { return nil }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = berlinTZ
    let todayComps = cal.dateComponents([.year, .month, .day], from: Date())
    guard let todayBerlin = cal.date(from: todayComps) else { return nil }
    let outFmt = DateFormatter()
    outFmt.dateFormat = "yyyy-MM-dd"
    outFmt.timeZone = TimeZone(identifier: "UTC")
    let todayIso = outFmt.string(from: todayBerlin)
    let todayWeekday = cal.component(.weekday, from: todayBerlin) // 1=So...7=Sa

    let sameWeekdayEntries = data.history.daily
        .filter { $0.date < todayIso && $0.tagesumsatzUsd != nil }
        .filter { entry -> Bool in
            guard let d = parseUtcDay(entry.date) else { return false }
            return cal.component(.weekday, from: d) == todayWeekday
        }
        .suffix(recentSameWeekdayCount)
    guard sameWeekdayEntries.count >= 3 else { return nil } // zu wenig Datenpunkte
    let avg = sameWeekdayEntries.compactMap { $0.tagesumsatzUsd }.reduce(0, +) / Double(sameWeekdayEntries.count)
    guard avg != 0 else { return nil }
    let pct = ((data.sinceYesterdayUsd - avg) / avg) * 100
    // Ausgeschriebener Plural statt Kuerzel (Nutzer-Feedback 21.08.2026, App-Sync mit
    // dem HTML-Dashboard: "8 Fr" war neben einer Zahl missverstaendlich).
    let weekdayNames = ["Sonntage", "Montage", "Dienstage", "Mittwoche", "Donnerstage", "Freitage", "Samstage"]
    return DayVsRecentSameWeekday(pct: pct, count: sameWeekdayEntries.count, weekdayLabel: weekdayNames[todayWeekday - 1])
}

// MARK: - Muster-Erkennung (rein statistisch aus der eigenen Historie)

func detectSeasonalPattern(_ data: EarningsData) -> String? {
    let monthly = data.history.monthly
    guard monthly.count >= 13 else { return nil }
    let now = Date()
    var cal = Calendar(identifier: .gregorian)
    let month = cal.component(.month, from: now)
    let year = cal.component(.year, from: now)
    let lastYearKey = "\(year - 1)-\(String(format: "%02d", month))"
    guard let lastYearEntry = monthly.first(where: { $0.month == lastYearKey }) else { return nil }
    let avgAll = monthly.reduce(0.0) { $0 + $1.eur } / Double(monthly.count)
    guard avgAll != 0 else { return nil }
    let dev = ((lastYearEntry.eur - avgAll) / avgAll) * 100
    guard abs(dev) >= 12 else { return nil }
    let monthNames = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"]
    let monthName = monthNames[month - 1]
    if dev < 0 {
        return "📉 Saisonal: \(monthName) lag im Vorjahr \(String(format: "%.0f", abs(dev)))% unter dem Durchschnitt — passt zu einem wiederkehrenden Muster (z.B. weniger Nutzung in dieser Jahreszeit)."
    } else {
        return "📈 Saisonal: \(monthName) lag im Vorjahr \(String(format: "%.0f", dev))% über dem Durchschnitt — dieser Monat ist historisch eher stark."
    }
}

func detectWeekdayPattern(_ data: EarningsData) -> String? {
    let (avgs, total) = computeWeekdayAverages(data.history.daily)
    guard total >= 21 else { return nil }
    let validAvgs = Array(avgs.values)
    guard !validAvgs.isEmpty else { return nil }
    let overallAvg = validAvgs.reduce(0, +) / Double(validAvgs.count)
    let todayWd = berlinWeekday(Date())
    guard let todayAvg = avgs[todayWd], overallAvg != 0 else { return nil }
    let dev = ((todayAvg - overallAvg) / overallAvg) * 100
    guard abs(dev) >= 12 else { return nil }
    let dayNames = ["Sonntage", "Montage", "Dienstage", "Mittwoche", "Donnerstage", "Freitage", "Samstage"]
    let name = dayNames[todayWd - 1]
    if dev < 0 {
        return "📅 Wochentag-Muster: \(name) liegen im Schnitt \(String(format: "%.0f", abs(dev)))% unter dem Wochendurchschnitt."
    } else {
        return "📅 Wochentag-Muster: \(name) liegen im Schnitt \(String(format: "%.0f", dev))% über dem Wochendurchschnitt."
    }
}

func detectTrendDeviation(_ data: EarningsData) -> String? {
    let weekly = data.history.weekly
    guard weekly.count >= 6 else { return nil }
    let current = weekly[weekly.count - 1]
    let baselineEnd = weekly.count - 1
    let baselineStart = max(0, baselineEnd - 8)
    let baseline = Array(weekly[baselineStart..<baselineEnd])
    guard baseline.count >= 4 else { return nil }
    let vals = baseline.map { $0.eur }
    let mean = vals.reduce(0, +) / Double(vals.count)
    let variance = vals.reduce(0.0) { $0 + pow($1 - mean, 2) } / Double(vals.count)
    let std = sqrt(variance)
    guard std != 0 else { return nil }
    let z = (current.eur - mean) / std
    guard abs(z) >= 1.3 else { return nil }
    if z > 0 {
        return "✨ Chance: Diese Woche liegt deutlich über dem üblichen Schwankungsbereich der letzten Wochen (\(fmtEur(current.eur)) vs. Ø \(fmtEur(mean))) — lohnt sich evtl. anzuschauen, was hier gut lief."
    } else {
        return "⚠️ Auffällig: Diese Woche liegt deutlich unter dem üblichen Schwankungsbereich der letzten Wochen (\(fmtEur(current.eur)) vs. Ø \(fmtEur(mean))) — nicht durch das saisonale Muster oben erklärt, könnte einen anderen Grund haben."
    }
}

func computeInsightPatterns(_ data: EarningsData) -> [String] {
    [detectTrendDeviation(data), detectSeasonalPattern(data), detectWeekdayPattern(data)].compactMap { $0 }
}

// MARK: - Saisonale Hinweise im "Gesamt"-Chart

/// Markiert NUR Wochen, die deutlich (>=20%) unter ihrem gleitenden 6-Wochen-Schnitt
/// liegen UND bei denen die naechstgelegene Woche im Vorjahr (max. 10 Tage Abstand)
/// selbst ebenfalls deutlich (>=15%) unter IHREM eigenen 6-Wochen-Schnitt lag - also ein
/// echtes wiederkehrendes Muster, keine Vermutung.
func computeSeasonalDips(_ series: [EarningsData.WeeklyPoint]) -> [Int: String] {
    var hints = [Int: String]()
    func trailingMean(_ idx: Int) -> Double? {
        let start = max(0, idx - 6)
        guard start < idx else { return nil }
        let window = series[start..<idx]
        guard !window.isEmpty else { return nil }
        return window.reduce(0.0) { $0 + $1.eur } / Double(window.count)
    }
    guard series.count > 6 else { return hints }
    for i in 6..<series.count {
        guard let mean = trailingMean(i), mean != 0 else { continue }
        let dev = ((series[i].eur - mean) / mean) * 100
        guard dev <= -20 else { continue }
        guard let thisDate = parseIso(series[i].weekStart) else { continue }
        let targetMs = thisDate.timeIntervalSince1970 - 364 * 24 * 60 * 60
        var closestIdx = -1
        var closestDiff = Double.infinity
        for j in 0..<i {
            guard let d = parseIso(series[j].weekStart) else { continue }
            let diff = abs(d.timeIntervalSince1970 - targetMs)
            if diff < closestDiff { closestDiff = diff; closestIdx = j }
        }
        guard closestIdx >= 0, closestDiff <= 10 * 24 * 60 * 60 else { continue }
        guard let closestMean = trailingMean(closestIdx), closestMean != 0 else { continue }
        let closestDev = ((series[closestIdx].eur - closestMean) / closestMean) * 100
        guard closestDev <= -15 else { continue }
        guard let d = parseIso(series[closestIdx].weekStart) else { continue }
        let labelFmt = DateFormatter()
        labelFmt.dateFormat = "dd.MM."
        labelFmt.timeZone = TimeZone(identifier: "UTC")
        hints[i] = "📉 Saisonal: ähnlicher Rückgang wie im Vorjahr um diese Zeit (\(fmtEur(series[closestIdx].eur)) am \(labelFmt.string(from: d)))"
    }
    return hints
}

// MARK: - Sparkline (letzte 8 Wochen, EUR) + Trend-Pfeil

struct SparklineInfo {
    let values: [Double]
    let up: Bool
    let pctLabel: String
}

/// Trend ueber Durchschnitt der ersten Haelfte vs. Durchschnitt der zweiten Haelfte des
/// Fensters - robuster gegen Zufallsschwankungen einzelner Wochen als ein reiner
/// Randpunkt-Vergleich.
func computeSparkline(_ weekly: [EarningsData.WeeklyPoint]) -> SparklineInfo? {
    let points = weekly.suffix(8)
    guard points.count >= 2 else { return nil }
    let values = points.map { $0.eur }
    let mid = values.count / 2
    let firstHalf = Array(values[0..<mid])
    let secondHalf = Array(values[mid...])
    let firstAvg = firstHalf.reduce(0, +) / Double(firstHalf.count)
    let secondAvg = secondHalf.reduce(0, +) / Double(secondHalf.count)
    let up = secondAvg >= firstAvg
    let pct = firstAvg != 0 ? ((secondAvg - firstAvg) / abs(firstAvg)) * 100 : 0
    return SparklineInfo(values: values, up: up, pctLabel: "\(up ? "▲" : "▼") \(String(format: "%.0f", abs(pct)))% (8 Wo.)")
}

struct Sparkline: View {
    let values: [Double]
    let up: Bool

    var body: some View {
        GeometryReader { geo in
            let minV = values.min() ?? 0
            let maxV = values.max() ?? 1
            let range = max(maxV - minV, 0.0001)
            Path { path in
                for (i, v) in values.enumerated() {
                    let x = values.count > 1 ? geo.size.width * CGFloat(i) / CGFloat(values.count - 1) : 0
                    let y = geo.size.height * (1 - CGFloat((v - minV) / range))
                    if i == 0 { path.move(to: CGPoint(x: x, y: y)) } else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            // Farbschema "heiss/kalt" fest verankert (Nutzer-Anforderung 21.08.2026).
            .stroke(up ? Brand.amber : Brand.blue, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
        }
    }
}

// MARK: - Insights-Popover (Muster-Erkennung + Wochennotiz)

struct InsightsSheet: View {
    let data: EarningsData
    @Environment(\.dismiss) private var dismiss
    @State private var noteText: String = ""
    @State private var editingNote = false

    private var latestWeekIso: String? { data.history.weekly.last?.weekStart }

    var body: some View {
        NavigationStack {
            List {
                Section("Wahrscheinliche Muster (statistisch, keine Garantie)") {
                    let patterns = computeInsightPatterns(data)
                    if patterns.isEmpty {
                        Text("Noch keine auffälligen Muster erkannt.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(patterns, id: \.self) { p in
                            Text(p).font(.subheadline)
                        }
                    }
                }
                Section("Notiz zur aktuellen Woche") {
                    if editingNote {
                        TextField("z.B. bekannter externer Grund", text: $noteText, axis: .vertical)
                        Button("Speichern") {
                            if let key = latestWeekIso { setNote(key, text: noteText) }
                            editingNote = false
                        }
                    } else {
                        Text(noteText.isEmpty ? "— (noch keine Notiz)" : noteText)
                            .foregroundStyle(noteText.isEmpty ? .secondary : .primary)
                        Button("Notiz bearbeiten") { editingNote = true }
                    }
                }
            }
            .navigationTitle("Insights")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Fertig") { dismiss() }
                }
            }
        }
        .onAppear { noteText = latestWeekIso.map(getNote) ?? "" }
    }
}

// MARK: - Wochennotizen (lokal auf dem Geraet gespeichert)

private let notesKey = "elevenlabsDashboardNotes_v1"

func getNote(_ weekStartIso: String) -> String {
    let notes = UserDefaults.standard.dictionary(forKey: notesKey) as? [String: String] ?? [:]
    return notes[weekStartIso] ?? ""
}

func setNote(_ weekStartIso: String, text: String) {
    var notes = UserDefaults.standard.dictionary(forKey: notesKey) as? [String: String] ?? [:]
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
        notes.removeValue(forKey: weekStartIso)
    } else {
        notes[weekStartIso] = trimmed
    }
    UserDefaults.standard.set(notes, forKey: notesKey)
}
