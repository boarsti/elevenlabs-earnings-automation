import Foundation

/// Wird in BEIDEM Targets gebraucht (App + Widget) - siehe README, Schritt 4.
enum Config {
    /// Aus apps-script/README.md - die Web-App-URL (endet auf /exec)
    static let bridgeURL = "https://script.google.com/macros/s/AKfycby6z5GC1Uzgbr-Qr5UzlrE329HADwX-rR5qrvi8F8t8vNwmoXpINThjA0YzzkxHL0xz/exec"
    /// Dasselbe Token, das in Code.gs als ACCESS_TOKEN eingetragen wurde
    static let bridgeToken = "366e636fffda2e793053addd242edc3f"
}
