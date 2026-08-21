import SwiftUI

/// Marken-Palette aus dem Styleguide (siehe Ordner 001, _MDs/styleguide-briefing-final.md)
/// - identisch zur Farbwelt des HTML-Dashboards.
enum Brand {
    static let ink = Color(red: 0x10 / 255, green: 0x17 / 255, blue: 0x3A / 255)
    static let ink2 = Color(red: 0x18 / 255, green: 0x20 / 255, blue: 0x55 / 255)
    static let amber = Color(red: 0xFF / 255, green: 0x8A / 255, blue: 0x1F / 255)
    static let blue = Color(red: 0x33 / 255, green: 0x55 / 255, blue: 0xFF / 255)
    static let success = Color(red: 0x3F / 255, green: 0xBF / 255, blue: 0x6F / 255)
    static let amberDeep = Color(red: 0xB3 / 255, green: 0x5A / 255, blue: 0x0A / 255)
    /// Duenne, gepunktete Vorjahres-Vergleichslinie im Verlauf-Chart.
    static let grayLine = Color(red: 0x9A / 255, green: 0xA0 / 255, blue: 0xC7 / 255)
}

func fmtUsd(_ n: Double?) -> String {
    guard let n else { return "—" }
    return n.formatted(.currency(code: "USD").locale(Locale(identifier: "de_DE")))
}

func fmtEur(_ n: Double?) -> String {
    guard let n else { return "—" }
    return n.formatted(.currency(code: "EUR").locale(Locale(identifier: "de_DE")))
}

/// Kompakte, gerundete $-Beschriftung ("41 $") fuer Balken-/Referenzlinien-Labels im
/// Tagesumsatz-Chart - identisch zur Rundung im HTML-Dashboard (Math.round), spart
/// Platz gegenueber der vollen Waehrungsformatierung.
func fmtUsdRounded(_ n: Double) -> String {
    "\(Int(n.rounded())) $"
}

/// Gerundete Zahl mit deutschem Tausenderpunkt ("16.320"), ohne Waehrungssymbol -
/// Pendant zu fmtThousands() im HTML-Dashboard, fuer Balken-/Referenzlinien-Labels
/// in den groesseren Jahres-/Monatsbetraegen (Nutzer-Feedback: "Achte auf
/// Tausender-Punkte").
private let thousandsFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.locale = Locale(identifier: "de_DE")
    f.numberStyle = .decimal
    f.maximumFractionDigits = 0
    f.usesGroupingSeparator = true
    return f
}()
func fmtThousands(_ n: Double) -> String {
    thousandsFormatter.string(from: NSNumber(value: n.rounded())) ?? "\(Int(n.rounded()))"
}
/// Wie fmtThousands(), plus Einheit dahinter ("16.320 €" / "314 $").
func fmtThousandsUnit(_ n: Double, unit: String) -> String {
    "\(fmtThousands(n)) \(unit)"
}

/// Kleine farbige Delta-Pille ("▲ 12,3%" gruen / "▼ 4,1%" amber) - siehe Referenz-
/// Screenshot (Home Assistant Dashboard), dort exakt dieses Muster bei den KPI-Karten.
struct DeltaPill: View {
    let percent: Double?

    var body: some View {
        if let percent {
            let up = percent >= 0
            // Farbschema "heiss/kalt" (Orange=Anstieg, Blau=Rueckgang) - fest im Design
            // verankert (Nutzer-Anforderung 21.08.2026), identisch zum HTML-Dashboard
            // (TREND_UP_COLOR/TREND_DOWN_COLOR).
            Text("\(up ? "▲" : "▼") \(abs(percent), specifier: "%.1f")%")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(up ? Brand.amber : Brand.blue)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background((up ? Brand.amber : Brand.blue).opacity(0.15), in: Capsule())
        }
    }
}

/// Kompakte Vergleichszeile ("Vorwoche: $12,34") unter einem Hauptwert. `color`
/// erlaubt Trend-Faerbung (Orange/Blau); Standard ist gedaempftes Grau.
struct CompareLine: View {
    let label: String
    let value: String?
    var color: Color = .secondary

    var body: some View {
        if let value {
            Text("\(label): \(value)")
                .font(.caption2)
                .foregroundStyle(color)
        }
    }
}

/// Status-Badge fuer Auszahlungen ("Ausgezahlt" gruen / "Ausstehend" amber).
struct StatusBadge: View {
    let status: String?

    var body: some View {
        let paid = status == "Paid"
        let label = paid ? "Ausgezahlt" : (status == "Pending" ? "Ausstehend" : (status ?? "—"))
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(paid ? Brand.success : Brand.amberDeep)
    }
}
