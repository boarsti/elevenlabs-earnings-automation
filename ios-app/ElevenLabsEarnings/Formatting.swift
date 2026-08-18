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
}

func fmtUsd(_ n: Double?) -> String {
    guard let n else { return "—" }
    return n.formatted(.currency(code: "USD").locale(Locale(identifier: "de_DE")))
}

func fmtEur(_ n: Double?) -> String {
    guard let n else { return "—" }
    return n.formatted(.currency(code: "EUR").locale(Locale(identifier: "de_DE")))
}

/// Kleine farbige Delta-Pille ("▲ 12,3%" gruen / "▼ 4,1%" amber) - siehe Referenz-
/// Screenshot (Home Assistant Dashboard), dort exakt dieses Muster bei den KPI-Karten.
struct DeltaPill: View {
    let percent: Double?

    var body: some View {
        if let percent {
            let up = percent >= 0
            Text("\(up ? "▲" : "▼") \(abs(percent), specifier: "%.1f")%")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(up ? Brand.success : Brand.amberDeep)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background((up ? Brand.success : Brand.amberDeep).opacity(0.15), in: Capsule())
        }
    }
}

/// Kompakte Vergleichszeile ("Vorwoche: $12,34") unter einem Hauptwert.
struct CompareLine: View {
    let label: String
    let value: String?

    var body: some View {
        if let value {
            Text("\(label): \(value)")
                .font(.caption2)
                .foregroundStyle(.secondary)
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
