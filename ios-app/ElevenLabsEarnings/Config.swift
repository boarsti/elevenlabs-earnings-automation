import Foundation

/// Wird in BEIDEM Targets gebraucht (App + Widget) - siehe README, Schritt 4.
enum Config {
    /// Aus apps-script/README.md - die Web-App-URL (endet auf /exec)
    static let bridgeURL = "HIER_DEINE_APPS_SCRIPT_WEB_APP_URL_EINTRAGEN"
    /// Dasselbe Token, das in Code.gs als ACCESS_TOKEN eingetragen wurde
    static let bridgeToken = "HIER_DEIN_TOKEN_EINTRAGEN"
}
