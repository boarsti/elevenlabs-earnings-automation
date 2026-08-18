// Unabhängige FX-Quelle (bewusst NICHT GOOGLEFINANCE - siehe Design-Doku:
// die bestehende GOOGLEFINANCE-Formel im Sheet liefert für den laufenden Tag
// nachweislich #N/A). Frankfurter.app ist kostenlos, ohne API-Key, EZB-Referenzkurse.

const FX_URL = "https://api.frankfurter.app/latest?from=USD&to=EUR";

export async function getUsdToEurRate() {
  const res = await fetch(FX_URL);
  if (!res.ok) {
    throw new Error(`FX-Abfrage fehlgeschlagen: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const rate = data?.rates?.EUR;
  if (typeof rate !== "number") {
    throw new Error(`Unerwartete FX-Antwort: ${JSON.stringify(data)}`);
  }
  return rate;
}
