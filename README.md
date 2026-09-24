# Webbasierter 3D IDX Viewer

[![GitHub Pages](https://img.shields.io/badge/Live_Demo-GitHub_Pages-blue?style=for-the-badge)](https://niclas85.github.io/IDX-Viewer/)
[![Direkthilfe](https://img.shields.io/badge/Hilfe-Direkt_oeffnen-0fbcf9?style=for-the-badge)](https://niclas85.github.io/IDX-Viewer/#hilfe)

Dies ist ein leistungsstarker, rein webbasierter 3D-Viewer und Editor für das **Prostep IVIP (PSI5) ECAD/MCAD Collaboration Format (IDX v4.5)**.

Das Tool ermöglicht die Visualisierung von Leiterplatten-Baselines (Base-Modellen) und deren inkrementellen Änderungen (Increments). MCAD/ECAD-Ingenieure können Änderungen grafisch nachvollziehen, diese akzeptieren oder ablehnen, sowie eigene manuelle Gegenvorschläge (Verschiebungen, Hinzufügungen, Löschungen) erarbeiten. 
Anschließend exportiert das Tool normgerechte IDX-Responses, um den digitalen Kommunikationszyklus zwischen den Disziplinen nahtlos fortzusetzen.

![Viewer Screenshot](docs/screenshots/loaded_idx.png)

## 🚀 Hauptfunktionen

- **Lokale Ausführung:** Läuft komplett lokal im Browser (Client-seitig, kein Server-Backend erforderlich). Alle 3D-Geometrien und XML-Verarbeitungen passieren in Echtzeit per JavaScript (Three.js & DOMParser).
- **Prostep IVIP (PSI5) Kompatibel:** Verarbeitet `_filtered.idx`, `_increment.idx` und exportiert entsprechende Response-XMLs.
- **Historien-Zeitstrahl (Timeliner):** Schritt-für-Schritt Navigation durch alle geladenen Inkremente, um Änderungen im Lebenszyklus der Platine visuell zu prüfen.
- **Akzeptieren / Ablehnen:** Einfaches Bewerten von Inkrementen per Knopfdruck. Abgelehnte Komponenten schnappen auf ihre Ursprungsposition zurück.
- **Manuelle Gegenvorschläge:** Per Drag & Drop oder über die Koordinaten-Maske lassen sich Bauteile verschieben oder neu hinzufügen.
- **Integrierte Makro-Engine:** Skript-basierte Automatisierung von Standard-Aufgaben (Ausblenden von Bauteilen, automatisches Setzen von Attributen etc.).
- **MCAD / ECAD Mapping:** Nutzt `.map` Dateien, um kryptische ECAD Bezeichnungen (RefDes) auf echte interne ERP / MCAD Materialnummern umzuschlüsseln. Optional lassen sich die gemappten Namen über **MCAD-Namen beim Export ins File schreiben** auch in die Exportdatei übernehmen.
- **Validierung vor dem Import:** Jede IDX-Datei wird geprüft, bevor sie übernommen wird (wohlgeformtes XML, Wurzelelement, Namensraum, Header, auflösbare Referenzen). Schlägt die Prüfung fehl, bleibt der bisherige Arbeitsstand unverändert. Zusätzlich geladene Inkremente werden an den Zeitstrahl angehängt statt ihn zu ersetzen.
- **Persistente Baumreihenfolge:** Umsortieren per Drag & Drop oder über **Ganz nach oben** / **Ganz nach unten**. Die eingestellte Reihenfolge überlebt den Neuaufbau des Modellbaums und wird in beide Exporte übernommen.
- **Optionale ID-Neunummerierung:** Über **IDs neu nummerieren (Reihenfolge für Creo)** werden die Instanz-IDs fortlaufend gemäß Modellbaum vergeben, da Creo die Baugruppenkomponenten nach der Instanznummer sortiert und nicht nach der Reihenfolge im Dateiinhalt. Standardmäßig ausgeschaltet, da ECAD-Inkremente auf die Original-IDs verweisen. Details und Risiken siehe [Anwenderdokumentation](docs/Anwenderdokumentation.md).

## 💻 Lokale Ausführung / Nutzung

Da die Anwendung rein clientbasiert ist, kann sie einfach über GitHub Pages oder durch lokales Öffnen aufgerufen werden:

1. Klonen Sie das Repository oder laden Sie es als ZIP herunter.
2. Öffnen Sie die Datei `idx.html` in einem modernen Webbrowser (Chrome, Edge, Firefox).
3. Laden Sie eine `_filtered.idx` Baseline per Drag & Drop.

*Tipp für Entwickler: Es wird empfohlen, einen lokalen Webserver (z. B. `npx http-server` oder `python -m http.server`) zu nutzen, um lokale OBJ-Ressourcen ohne CORS-Einschränkungen zu laden.*

## ⚙️ Makro-Engine (Beispiel)

Das Tool verfügt über eine eigene Makro-Sprache für repetitive Prozesse. Ein Beispielscript könnte wie folgt aussehen:

```text
# Automatischer Aufräum-Prozess
ToggleType(Cutout, false)
ToggleType(KeepOut, false)
Filter(HOLE)
Select(visible)
Exclude()
Clear()
Sleep(500)
```

## 🧪 Tests

Das Projekt nutzt [Playwright](https://playwright.dev/) für End-to-End Tests der XML-Export Logik und Rendering-Pipeline.
Zum Ausführen der Tests:

```bash
npm install
npx playwright test
```

Die Tests `test_idx_preimport_validation.spec.js`, `test_deleted_component_rendering.spec.js` und
`test_export_smoke.spec.js` laufen ohne Browser (jsdom) und benötigen kein `npx playwright install`:

```bash
npx playwright test tests/test_export_smoke.spec.js
```

`test_e2e_full.spec.js` und `test_auto_macro.spec.js` benötigen zusätzlich einen installierten
Chromium sowie reale IDX-Beispieldateien, die nicht im Repository liegen (`*.idx` steht in
`.gitignore`).

## 📜 Lizenz & Herkunft

Dieses Projekt basiert auf internen Entwicklungen zur Verbesserung des ECAD-MCAD Datenaustauschs. 
Es steht als Open Source zur Verfügung, um die Tool-Landschaft rund um das IDX-Protokoll zu bereichern.
