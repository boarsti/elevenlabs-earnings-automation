import SwiftUI

/// Tab 1 "Heute": die wichtigsten Headline-Werte, kompakt und ohne langes Scrollen -
/// orientiert an der Referenz (Home-Assistant-Dashboard: grosse Hero-Karte oben,
/// darunter kompakte Vergleichszeilen mit farbigen Delta-Pillen statt einer langen
/// Tabelle).
struct OverviewView: View {
    let data: EarningsData
    @State private var showInsights = false

    private var records: Records { computeRecords(data) }

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

                sparklineHeader

                heroCard

                HStack(spacing: 12) {
                    compactCard(title: "Diese Woche", value: fmtUsd(data.thisWeekUsdNet), border: trendColor(data.thisWeekVsLastWeekPct)) {
                        // Reihenfolge nach Nutzer-Anforderung 21.08.2026 (App-Sync mit dem
                        // HTML-Dashboard Feld2): "bis jetzt ca." + "aktuell gesamt" nach
                        // oben, "Vorwoche gleicher Zeitraum" an 3. Stelle, "Rekord Woche"
                        // ganz unten.
                        if data.fxRateUsdEur > 0 {
                            Text("bis jetzt ca. \(fmtEur(data.thisWeekUsdNet * data.fxRateUsdEur))")
                                .font(.caption2).foregroundStyle(Brand.amber)
                        }
                        // Aktueller Gesamtwert (Startwert + reale Steigerung seit dem
                        // letzten Ablesezeitpunkt, KEINE Projektion) - Nutzer-Anforderung
                        // 20.08.2026, am 21.08.2026 erneut angemerkt (App-Sync mit dem
                        // HTML-Dashboard Feld2). data.currentPeriodUsd ist der taufrische
                        // Live-Wert, kann leicht von data.thisWeekUsdNet abweichen, da
                        // Letzteres nur so aktuell ist wie der letzte Collector-Schreib-
                        // vorgang ins Sheet.
                        Text("aktuell gesamt: \(fmtUsd(data.currentPeriodUsd))\(data.fxRateUsdEur > 0 ? " (~\(fmtEur(data.currentPeriodUsd * data.fxRateUsdEur)))" : "")")
                            .font(.caption2).foregroundStyle(.secondary)
                        // "gleicher Zeitraum" statt nur "Vorwoche" (Nutzer-Korrektur
                        // 21.08.2026, App-Sync mit dem HTML-Dashboard): macht explizit,
                        // dass hier der Vorwochenwert zum exakt gleichen relativen
                        // Zeitpunkt gemeint ist, nicht die volle Vorwochensumme.
                        CompareLine(
                            label: "Vorwoche gleicher Zeitraum", value: data.lastWeekUsdSameOffset.map(fmtUsd),
                            color: trendColorOrSecondary(data.lastWeekUsdSameOffset.map { data.thisWeekUsdNet - $0 })
                        )
                        // Startwert: das Guthaben, das beim letzten woechentlichen
                        // Rollover auf dem ElevenLabs-Konto stehen blieb und NICHT
                        // ausgezahlt wurde (Nutzer-Anmerkung 21.08.2026: "das ist der
                        // Startwert, den Elevenlabs willkuerlich stehen laesst und nicht
                        // auszahlt"). data.weekStartBalanceUsd, direkt von der Bruecke.
                        if let weekStart = data.weekStartBalanceUsd {
                            Text("Startwert (nicht ausgezahlt): ~\(fmtUsd(weekStart))\(data.fxRateUsdEur > 0 ? " (~\(fmtEur(weekStart * data.fxRateUsdEur)))" : "")")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        // computeWeekProjection() liefert den gesamten hochgerechneten
                        // Wochenwert (Ist + Restbetrag) - jetzt zusaetzlich zur EUR-
                        // Naeherung auch in $ (Nutzer-Feedback 20.08.2026: "wo schreiben
                        // wir den [aktuellen Gesamt-Dollar-Wert] hin?"). Zeilenumbruch
                        // nach dem Datum + volles Datum inkl. Jahr (Nutzer-Anforderung
                        // 21.08.2026, App-Sync mit dem HTML-Dashboard Feld2).
                        if let projection = computeWeekProjection(data) {
                            let eurPart = data.fxRateUsdEur > 0 ? " (~\(fmtEur(projection * data.fxRateUsdEur)))" : ""
                            let dateLabel = data.nextReadoutEstimateIso.map(formatShortDateYY) ?? "Wochenende"
                            Text("Progn. vorauss. bis \(dateLabel)\n~\(fmtUsd(projection))\(eurPart)")
                                .font(.caption2).foregroundStyle(Brand.blue)
                        }
                        if let bestWeek = records.bestWeek {
                            Text("Rekord Woche: \(fmtEur(bestWeek.eur)) (\(formatShortDateYY(bestWeek.weekStart)))")
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    compactCard(title: "Ø pro Tag", value: fmtUsd(data.avgDailyUsd), border: nil) {
                        CompareLine(
                            label: "Vorwoche gleicher Zeitraum", value: data.lastWeekAvgDailyUsd.map(fmtUsd),
                            color: trendColorOrSecondary(
                                (data.avgDailyUsd != nil && data.lastWeekAvgDailyUsd != nil) ? data.avgDailyUsd! - data.lastWeekAvgDailyUsd! : nil
                            )
                        )
                        if let basis = avgDailyBasisLabel(data) {
                            Text(basis).font(.caption2).foregroundStyle(.secondary)
                        }
                        // Ganz unten, analog zur Prognose-Zeile in "Diese Woche" (Nutzer-
                        // Feedback 20.08.2026: hochgerechneter Tagesschnitt ueber die
                        // volle Woche statt nur ueber die bisher vergangenen Tage).
                        if let projection = computeWeekProjection(data) {
                            Text("Prognose Ø/Tag (Woche): ~\(fmtUsd(projection / 7))")
                                .font(.caption2).foregroundStyle(Brand.blue)
                        }
                        // Langfristige Ø/Tag-Vergleiche (Nutzer-Anforderung 21.08.2026,
                        // App-Sync mit dem HTML-Dashboard Feld3): mit Trend-Prozent
                        // ggü. dem aktuellen Wochendurchschnitt data.avgDailyUsd.
                        if let avg3m = computeAvgDailyOverDays(data.history.daily, days: 90) {
                            CompareLine(
                                label: "Ø/Tag letzte 3 Monate",
                                value: "\(fmtUsd(avg3m))\(longTermTrendSuffix(current: data.avgDailyUsd, longTerm: avg3m))",
                                color: trendColorOrSecondary(data.avgDailyUsd.map { $0 - avg3m })
                            )
                        }
                        if let avg12m = computeAvgDailyOverDays(data.history.daily, days: 365) {
                            CompareLine(
                                label: "Ø/Tag 12 Monate",
                                value: "\(fmtUsd(avg12m))\(longTermTrendSuffix(current: data.avgDailyUsd, longTerm: avg12m))",
                                color: trendColorOrSecondary(data.avgDailyUsd.map { $0 - avg12m })
                            )
                        }
                    }
                }

                VStack(spacing: 10) {
                    euroRow(
                        icon: "eurosign.circle.fill",
                        title: "EUR / letzte Abrechnung",
                        value: fmtEur(data.thisWeekEur),
                        pill: data.thisWeekVsLastWeekPct,
                        compareLabel: "Vorwoche",
                        compareValue: data.lastWeekEurDirect.map(fmtEur),
                        trend: data.lastWeekEurDirect.map { data.thisWeekEur - $0 }
                    )
                    Divider().overlay(Color.white.opacity(0.08))
                    euroRow(
                        icon: "calendar",
                        title: "Dieser Monat (EUR)",
                        value: fmtEur(data.thisMonthEur),
                        pill: nil,
                        compareLabel: "Vormonat",
                        compareValue: data.lastMonthEur.map(fmtEur),
                        trend: data.lastMonthEur.map { data.thisMonthEur - $0 }
                    )
                    Divider().overlay(Color.white.opacity(0.08))
                    euroRow(
                        icon: "chart.line.uptrend.xyaxis",
                        title: "Dieses Jahr (EUR)",
                        value: fmtEur(data.thisYearEur),
                        pill: nil,
                        // Nutzer-Korrektur 21.08.2026: "nicht 'Vergleich 2025 bis heute' sondern
                        // 'Vergleich zu TT.MM.2025'" - App-Sync mit dem HTML-Dashboard (Feld6).
                        compareLabel: "Vergleich zu \(lastYearSameDayLabel())",
                        compareValue: data.lastYearEurSamePeriod.map(fmtEur),
                        trend: data.lastYearEurSamePeriod.map { data.thisYearEur - $0 }
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
        .sheet(isPresented: $showInsights) { InsightsSheet(data: data) }
    }

    private func trendColorOrSecondary(_ value: Double?) -> Color {
        trendColor(value) ?? .secondary
    }

    /// App-Sync 26.08.2026 (HTML-Dashboard Feld4-6, Nutzer-Korrektur): die Trendfarbe
    /// gehoert auf den AKTUELLEN Wert (orange bei Steigerung/blau bei Rueckgang),
    /// nicht auf den Vergleichswert - der bleibt immer neutral weiss. Vorher war das
    /// hier (wie im Dashboard) versehentlich vertauscht.
    private func trendColorOrWhite(_ value: Double?) -> Color {
        trendColor(value) ?? .white
    }

    /// "(▲ 5%)"/"(▼ 5%)"-Anhaengsel fuer die Langzeit-Ø/Tag-Zeilen (App-Sync mit dem
    /// HTML-Dashboard Feld3, Nutzer-Anforderung 21.08.2026).
    private func longTermTrendSuffix(current: Double?, longTerm: Double) -> String {
        guard let current, longTerm != 0 else { return "" }
        let pct = ((current - longTerm) / longTerm) * 100
        let up = pct >= 0
        return " (\(up ? "▲" : "▼") \(String(format: "%.0f", abs(pct)))%)"
    }

    /// Heutiges Datum minus 1 Kalenderjahr, ausgeschrieben ("21.08.2025") - fuer das
    /// Feld6-Label "Vergleich zu ..." (Nutzer-Korrektur 21.08.2026).
    private func lastYearSameDayLabel() -> String {
        guard let lastYear = Calendar.current.date(byAdding: .year, value: -1, to: Date()) else { return "" }
        let out = DateFormatter()
        out.locale = Locale(identifier: "de_DE")
        out.timeZone = TimeZone(identifier: "Europe/Berlin")
        out.dateFormat = "dd.MM.yyyy"
        return out.string(from: lastYear)
    }

    @ViewBuilder
    private var sparklineHeader: some View {
        if let info = computeSparkline(data.history.weekly) {
            Button {
                showInsights = true
            } label: {
                HStack(spacing: 6) {
                    Sparkline(values: info.values, up: info.up)
                        .frame(width: 60, height: 20)
                    // Farbschema "heiss/kalt" fest verankert (Nutzer-Anforderung 21.08.2026).
                    Text(info.pctLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(info.up ? Brand.amber : Brand.blue)
                    Image(systemName: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
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
            if let bestDay = records.bestDay, let t = bestDay.tagesumsatzUsd {
                Text("Rekord Tag: \(fmtUsd(t)) (\(formatShortDateYY(bestDay.date)))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let dvly = computeDayVsRecentSameWeekday(data) {
                Text("\(dvly.pct >= 0 ? "▲" : "▼") \(String(format: "%.0f", abs(dvly.pct)))% ggü. Ø letzte \(dvly.count) \(dvly.weekdayLabel)")
                    .font(.caption2)
                    .foregroundStyle(trendColorOrSecondary(dvly.pct))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
        .background(Brand.ink2, in: RoundedRectangle(cornerRadius: 20))
    }

    @ViewBuilder
    private func compactCard(title: String, value: String, border: Color?, @ViewBuilder compare: () -> some View) -> some View {
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
        .overlay(alignment: .leading) {
            if let border {
                Rectangle().fill(border).frame(width: 3)
            }
        }
    }

    private func euroRow(icon: String, title: String, value: String, pill: Double?, compareLabel: String, compareValue: String?, trend: Double?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Brand.amber)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Text(value).font(.headline).foregroundStyle(trendColorOrWhite(trend))
                    DeltaPill(percent: pill)
                }
                CompareLine(label: compareLabel, value: compareValue, color: .white)
            }
            Spacer()
        }
        .overlay(alignment: .leading) {
            if let color = trendColor(trend) {
                Rectangle().fill(color).frame(width: 3)
            }
        }
        .padding(.leading, 4)
    }
}

#Preview {
    OverviewView(data: .placeholder)
}
