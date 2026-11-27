# Phase 6 — gepaarte Entwicklungsdiagnose

Alle Werte stammen aus den eingefrorenen Phase-5-Dateien. Die 40 CSV-Fälle und das früher entblindete Panel sind Entwicklungsdaten, kein neuer Holdout. Das Panel enthält zwölf Produkte, davon neun mit eindeutiger Referenz; drei bleiben bei Treffern und Paarvergleichen unbewertet. Die Guard-Zählungen betreffen alle zwölf Panel-Fälle. Shuhans vollständige Einzelfallvorhersagen sind lokal nicht verfügbar, daher ist kein gepaarter Vergleich möglich.

## Gepaarte Entscheidungen

„Verbessert“ bedeutet vorher falsch und nachher richtig, „verschlechtert“ das Gegenteil; Netto ist die Differenz. Alle übrigen Änderungen waren hier null oder blieben unverändert.

| Vergleich | CSV verbessert / verschlechtert / Netto | Panel verbessert / verschlechtert / Netto |
| --- | ---: | ---: |
| Luna → Terra | 5 / 2 / +3 | 2 / 1 / +1 |
| Luna → bestehender Guard | 0 / 3 / −3 | 0 / 0 / 0 |
| Luna → strenger Guard | 9 / 11 / −2 | 1 / 1 / 0 |
| Terra → bestehender Guard | 0 / 3 / −3 | 0 / 0 / 0 |
| Terra → strenger Guard | 5 / 8 / −3 | 1 / 1 / 0 |
| Luna bestehender → strenger Guard | 9 / 8 / +1 | 1 / 1 / 0 |
| Terra bestehender → strenger Guard | 5 / 5 / 0 | 1 / 1 / 0 |
| Keyless → Recovery | 0 / 0 / 0 | 0 / 1 / −1 |

Terra wechselte gegenüber Luna zugleich Modell, Zusatzbudget und Rechercheanweisung. Die Paarzahlen trennen diese Einflüsse nicht. Auf der CSV erreicht Terra 21/40; die Recall-Werte sind Green 7/14, Yellow 11/16, Red 3/10. Es gibt fünf falsche Greens, kein Red→Green und kein falsches Red. Luna erreicht 18/40, Recall 8/14, 7/16, 3/10, neun falsche Greens und ebenfalls kein Red→Green oder falsches Red. Terras strenger Guard erreicht 18/40 mit Recall 2/14, 16/16, 0/10 und keinen falschen Greens oder Reds. Alle sieben von Terra übersehenen Reds wurden Yellow.

Im auswertbaren Panel erreicht Terra 5/9, Recall Green 2/5 und Yellow 3/4, mit einem falschen Green und keinem falschen Red. Es gibt keine Red-Referenz; Red-Recall und eine Aussage über die Red→Green-Rate sind daher nicht bestimmbar. Der strenge Guard erreicht ebenfalls 5/9, Recall 1/5 und 4/4, ohne falsches Green oder Red. Recovery erzeugt dort ein falsches Red; das eingefrorene Ergebnis enthält den bekannten Fehler einer Verwechslung von Release und Produktfamilie und wurde nachträglich gepatcht, ohne neuen Blindwert.

## Guard und Belege

Auf der CSV änderte der bestehende Guard bei Luna und Terra jeweils drei Red zu Yellow. Seine protokollierte Regel lautet jeweils, dass kein Red-Grund den Zitat-Audit überstand. Die drei betroffenen Red-Gründe tragen zugleich den Status `quote_verified`: Zitatfund und Eignung im Guard sind unterschiedliche Prüfungen; die gespeicherten Daten belegen für sich keinen weiteren Grund. Der strenge Guard änderte bei Luna 17 Green und drei Red, bei Terra zehn Green und drei Red jeweils zu Yellow. Seine Regel für die Green-Fälle nennt fehlende hinreichende Stützung. Bei den geänderten Terra-Fällen sind die 13 Gründe nach Status verteilt: sechs `quote_verified`, vier `source_unreachable`, drei `no_quote`; sie umfassen zehn Green- und drei Red-Gründe. Diese Statuszählungen beschreiben sämtliche Gründe in geänderten Fällen, nicht zwingend entfernte Einzelbelege oder Ursachen.

Im Panel änderte der bestehende Guard keinen Fall; der strenge Guard änderte zwei Luna-Greens und drei Terra-Greens zu Yellow. Für die drei Terra-Fälle sind drei Gründe unerreichbar, bei einem wurde das Zitat nicht gefunden und bei einem fehlte es.

Die separate modellbasierte Inhaltsprüfung sah Terra in 8/40 CSV-Fällen als hinreichend belegt; sechs waren zugleich korrekt (6/40). Im Panel waren 2/12 hinreichend belegt und beide unter den neun bewertbaren Fällen korrekt (2/9; 2/12 insgesamt). Das ist keine unabhängige menschliche Zertifizierung.

Die Keyless-Grundrecherche meldete 4/40 und 2/12 Forschungsfehler; Recovery ebenfalls 4/40 und 2/12. Abrufversuche einschließlich Fehler waren 142/222 auf der CSV und 41/68 im Panel; Netzwerkabrufe des zweiten Arms profitierten vom gemeinsamen Cache. Fehlversuche waren 15/17 beziehungsweise 7/8. Unterschiede in den Fehlversuchen sind keine Produktfehlerzählung.

Reproduktion ab Projektstamm: `node veritas/bench/phase6-paired.mjs`. Das Skript vergleicht alle berechneten Konfusionsmatrizen und Trefferzahlen mit `metrics.json` und schreibt `test-results/phase6-20261127/paired-analysis.json` mit Paaren, IDs, Recall, Fehlern und Guard-Status. Es führt keine Netzwerkanfragen aus.

### Diagnose der drei Terra-Red-Rücknahmen

Ein Offline-Replay des gespeicherten Seiteninhalts reproduziert je einen Kandidaten, `INSUFFICIENT_EVIDENCE` und eine leere Evidence-Ausgabe. Alle drei Zitate wurden exakt gefunden und bestanden den Entity-Abgleich. Dieser Abgleich darf auch den umgebenden Kontext und Titel nutzen; die deterministische Stance- und Relevanzprüfung bewertet dagegen das kurze Zitat selbst. Die Gesamtqualität ist kein Wahrheitswert und überstimmt das Relevanz-Gate nicht.

| Produkt | Heuristik auf dem gespeicherten Zitat | Relevanzteil / Gesamtqualität | Ergebnis vor Ausgabe |
| --- | --- | ---: | --- |
| DoNotPay | `partial`, kritischer Begriff `ftc` fehlt; `ai` vorhanden | 10 / 63 | Relevanz unter 25 setzt `neutral` |
| accessiBe | `neutral`, kritische Begriffe `ftc` und `wcag` fehlen | 9 / 55 | `neutral` |
| Avast | `neutral`, kritischer Begriff `ftc` fehlt | 0 / 53 | `neutral` |

Der Engine-Filter lässt unbenutzte neutrale Kandidaten aus der Evidence-Ausgabe weg. Der Guard sieht deshalb keinen etablierten materiellen Negativbefund und zieht die Red-Urteile zurück. Das erklärt den beobachteten Verarbeitungspfad; es beweist weder, dass die umfassenden Aussagen falsch sind, noch dass jedes kurze Zitat sie vollständig belegt. Insbesondere nennt accessiBes Zitat nur die endgültige Genehmigung, nicht die WCAG-Aussage oder die Zahlung; bei DoNotPay und Avast decken die kurzen Ausschnitte ebenfalls nicht alle Bestandteile der zusammengesetzten Behauptung ab. Andere Stellen der gespeicherten Seiten oder ein semantischer Prüfer wurden hier nicht als Ersatzbeleg bewertet. Die Gegenprüfung nutzt weder Netzwerk noch optionalen Judge; sie rechtfertigt keine pauschale Abschwächung der Prüfregeln. Die maschinenlesbaren Einzelwerte stehen in `paired-guard-diagnostics.json`.
