import SwiftUI

/// Root-Ansicht: 3 Tabs statt einer langen Scroll-Seite - effiziente Display-Nutzung,
/// orientiert an der vom Nutzer verlinkten Referenz (Home-Assistant-Dashboard mit
/// Home/Energy/Office-Tabs). Laedt die Daten einmal zentral, alle Tabs teilen sie.
struct DashboardView: View {
    @State private var data: EarningsData = .placeholder
    @State private var errorMessage: String?

    var body: some View {
        TabView {
            NavigationStack {
                OverviewView(data: data)
                    .navigationTitle("Heute")
                    .toolbarBackground(Brand.ink, for: .navigationBar)
            }
            .tabItem { Label("Heute", systemImage: "house.fill") }

            NavigationStack {
                HistoryView(data: data)
                    .navigationTitle("Verlauf")
                    .toolbarBackground(Brand.ink, for: .navigationBar)
            }
            .tabItem { Label("Verlauf", systemImage: "chart.line.uptrend.xyaxis") }

            NavigationStack {
                PayoutsView(data: data)
            }
            .tabItem { Label("Auszahlungen", systemImage: "list.bullet.rectangle") }
        }
        .task {
            // Spiegelt POLL_INTERVAL_MS im HTML-Dashboard / den 15-Min-Collector-Takt.
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 15 * 60 * 1_000_000_000)
            }
        }
        .overlay(alignment: .top) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.white)
                    .padding(8)
                    .background(Brand.amberDeep, in: RoundedRectangle(cornerRadius: 10))
                    .padding()
            }
        }
    }

    private func load() async {
        do {
            data = try await EarningsClient.fetch()
            errorMessage = nil
        } catch {
            errorMessage = "Konnte Daten nicht laden: \(error.localizedDescription)"
        }
    }
}

#Preview {
    DashboardView()
}
