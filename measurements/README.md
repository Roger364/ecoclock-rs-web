# Mesures

Ce dossier contient les mesures qui engagent le projet, pas des relevés d'ambiance.

## Campagne CPPC2 — Ryzen 9 5900X (17/11/2026)

But : savoir si les leviers AMD exposés par Windows (`PERFEPP`, `PERFBOOSTMODE`,
`PROCFREQMAX`) changent réellement quelque chose, avant d'en proposer d'autres.

Banc : `scripts/measure-cppc.ps1`. Travail fixe (4 750 052 240 itérations d'un
LCG), 3 passes par phase, médiane, chauffe de 3 s, 11 phases. Les réglages sont
écrits par `powrprof` puis **réactivés** (`PowerSetActiveScheme`) ; les valeurs
AC et DC initiales sont restaurées dans un `finally` et relues après coup.

| Phase | Médiane | Écart | Étendue |
|---|---|---|---|
| référence | 6 022,6 ms | — | 70 ms |
| EPP 0 | 6 121,8 ms | +1,6 % | 84 ms |
| EPP 50 | 6 028,9 ms | +0,1 % | 14 ms |
| EPP 100 | 6 105,2 ms | +1,4 % | 71 ms |
| Turbo agressif | 6 134,6 ms | +1,9 % | 53 ms |
| Turbo efficient | 6 114,2 ms | +1,5 % | 22 ms |
| Turbo désactivé | 7 806,4 ms | **+29,6 %** | 5 ms |
| Plafond 3 300 MHz | 8 642,2 ms | **+43,5 %** | 3 ms |
| Plafond 2 000 MHz | 8 630,1 ms | **+43,3 %** | 4 ms |
| Plafond 0 | 6 135,3 ms | +1,9 % | 33 ms |
| référence finale | 6 121,1 ms | +1,6 % | 66 ms |

### Ce que ça dit

- **EPP ne change rien** au débit d'une charge fixe : les trois valeurs tiennent
  dans le bruit (±1,6 %, soit la dérive entre les deux références). Sur ce CPU,
  ce n'est pas un levier de performance, seulement une préférence énergétique.
- **Le turbo coûte 30 %** quand on le coupe.
- **Le plafond n'a qu'un cran** : 3 300 et 2 000 MHz donnent le même temps et la
  même fréquence rapportée (3 342 MHz). Le firmware ne descend pas plus bas.
- Une charge d'une seconde **sous-estime** le plafond de moitié (+21,8 %) : le
  début de passe se fait encore en boost, ce qui dilue la moyenne.

### Limites

- Un seul poste, un seul CPU. Rien ici n'est une promesse pour un autre modèle.
- La fréquence rapportée par `CallNtPowerInformation` vaut 3 701 MHz (la base)
  dès que le plafond est inactif : elle ne montre pas le boost réel. Seul le
  temps fait foi ; la fréquence ne sert qu'à confirmer qu'un plafond s'applique.
- Pas de température : `MSAcpi_ThermalZoneTemperature` est absent sur ce poste,
  et lire Tctl demanderait un pilote noyau, hors du contrat du projet.

## Reproduire

```powershell
# console élevée
.\scripts\measure-cppc.ps1 -Passes 3 -TargetMs 6000
```

La matrice et les valeurs initiales sont affichées ; `-DryRun` ne touche à rien.
`cppc2-PC-TOUR-24-long.csv` est la donnée brute de la campagne ci-dessus.
