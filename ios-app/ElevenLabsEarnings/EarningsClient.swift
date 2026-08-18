import Foundation

/// Wird in BEIDEN Targets gebraucht (App + Widget) - siehe README, Schritt 4.
enum EarningsClient {
    enum ClientError: Error { case badURL, server(String) }

    static func fetch() async throws -> EarningsData {
        guard var components = URLComponents(string: Config.bridgeURL) else {
            throw ClientError.badURL
        }
        components.queryItems = [URLQueryItem(name: "token", value: Config.bridgeToken)]
        guard let url = components.url else { throw ClientError.badURL }

        let (data, _) = try await URLSession.shared.data(from: url)

        if let errorPayload = try? JSONDecoder().decode([String: String].self, from: data),
           let message = errorPayload["error"] {
            throw ClientError.server(message)
        }

        return try JSONDecoder().decode(EarningsData.self, from: data)
    }
}
