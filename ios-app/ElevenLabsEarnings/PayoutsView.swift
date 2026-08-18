import SwiftUI

/// Tab 3 "Auszahlungen": vollstaendige Liste, spiegelt die "Alle Auszahlungen"-Tabelle
/// im HTML-Dashboard (inkl. Ø/Tag-Spalte und Status).
struct PayoutsView: View {
    let data: EarningsData

    var body: some View {
        List {
            ForEach(data.history.weekly.reversed()) { w in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(formatReadoutDateTime(w.weekStart))
                            .font(.subheadline.weight(.medium))
                        StatusBadge(status: w.status)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(fmtEur(w.eur)).font(.subheadline.weight(.semibold))
                        if let avg = w.avgPerDayEur {
                            Text("Ø \(fmtEur(avg))/Tag")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowBackground(Brand.ink2)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Brand.ink.ignoresSafeArea())
        .navigationTitle("Alle Auszahlungen")
    }
}

#Preview {
    PayoutsView(data: .placeholder)
}
