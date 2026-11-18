import { TooltipDoc } from "../types/hardware";

export const TOOLTIPS = {
  // === PRIVILÈGES, AUTOSTART & SÉCURITÉ ===
  privilege_mode: {
    key: "privilege_mode",
    title: "Modèle Double-Privilège (User asInvoker → Élévation UAC à la demande)",
    subsystem: "Sécurité Windows",
    privilege: "both",
    winApi: "OpenProcessToken(TOKEN_QUERY) + GetTokenInformation(TokenElevation) / ShellExecuteExW(L\"runas\")",
    summary:
      "L'exécutable embarque un manifeste UAC `requestedExecutionLevel level=\"asInvoker\"` : il démarre toujours dans le jeton utilisateur standard sans popup intrusive et contrôle déjà ~65% des économies d'énergie (plan d'alimentation actif CPU, Turbo Boost, EPP, EcoQoS, fréquence écran Hz, USB Suspend, Wi-Fi PSP).",
    physicsDetail:
      "L'élévation Administrateur (jeton filtré déverrouillé via `ShellExecuteExW` avec verbe `runas` et passage sécurisé `--elevated --slot N`) débloque les appels matériels globaux : `nvmlDeviceSetPowerManagementLimit` & `SetGpuLockedClocks` sur le GPU dédié, sous-états PCIe ASPM L1.2, NVMe APST PS4, Core Parking, RAPL PL1, NIC EEE 802.3az et la tâche planifiée au démarrage sans UAC.",
    beforeAfterHint:
      "Mode User seul : jusqu'à -48 W économisés (0 popup). Mode Admin : jusqu'à -95 W économisés (déblocage Power Limit GPU + NVMe PS4 + PL1).",
    safetyNote:
      "AUCUN pilote noyau Ring-0 tiers (ni WinRing0, ni RwDrv) n'est chargé : 100% compatible Windows 11 HVCI (Intégrité mémoire), VBS, Secure Boot et anti-cheats kernel.",
  },

  autostart_windows: {
    key: "autostart_windows",
    title: "Démarrage Automatique avec Windows & Persistance des 5 Profils",
    subsystem: "Intégration Système",
    privilege: "both",
    winApi: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run  |  COM ITaskService (TASK_RUNLEVEL_HIGHEST)",
    summary:
      "Deux mécanismes propres selon vos droits : en mode User, une unique valeur chaîne dans `HKCU\\...\\Run` lance `ecoclock.exe --tray --apply-profile <1..5>`. En mode Admin, une tâche planifiée Windows signée (`\\EcoClock\\Autostart`) s'exécute à l'ouverture de session avec `RunLevel = HighestAvailable` sans afficher de fenêtre UAC à chaque boot.",
    physicsDetail:
      "Les 5 profils sont sérialisés dans `%APPDATA%\\EcoClock\\profiles.toml` (~2,4 Ko) via écriture atomique (`WriteFile` dans `.tmp` + `FlushFileBuffers` + `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`), empêchant toute corruption même en cas de coupure secteur.",
    beforeAfterHint:
      "Temps ajouté au démarrage de Windows : ~6,8 ms (binaire natif Rust 418 Ko sans runtime WebView/.NET). Empreinte RAM en icône systray : 4,6 Mo.",
    safetyNote:
      "Garde-fou Safe-Boot intégré : attend 15 s de stabilité après connexion et désarme automatiquement l'autostart si un arrêt anormal précédent est détecté dans `rollback.toml`.",
  },

  rollback_guard: {
    key: "rollback_guard",
    title: "Architecture Sûre : RollbackGuard RAII & Plafonnement Officiel (0 Crash)",
    subsystem: "Sûreté Rust",
    privilege: "both",
    winApi: "SetConsoleCtrlHandler + WM_QUERYENDSESSION + std::panic::set_hook + GUID snapshot",
    summary:
      "Avant la toute première modification, EcoClock photographie l'intégralité des registres PowerCfg, NVML et d'affichage d'origine dans `%APPDATA%\\EcoClock\\baseline_snapshot.toml`. `power_plan::read_into_config` lit les index AC actifs via `PowerReadACValueIndex` et la fréquence d'écran via `EnumDisplaySettingsW` avant toute modification. À la fermeture normale et sur panic, le destructeur RAII ré-applique cette photographie ; après un arrêt brutal, la sentinelle `boot_apply.lock` désarme automatiquement l'autostart (note : sous `windows_subsystem = 'windows'`, l'interception de `WM_ENDSESSION` reste à compléter pour couvrir aussi l'extinction OS fenêtre ouverte).",
    physicsDetail:
      "Contrairement à l'undervolting manuel (offset négatif mV qui réduit la marge de bruit des transistors et peut provoquer des erreurs WHEA ou BSOD), EcoClock pratique l'underclocking par plafonnement d'états P/C officiels : le CPU et le GPU choisissent eux-mêmes la tension Vmin certifiée en usine pour la fréquence abaissée !",
    beforeAfterHint:
      "Taux d'erreur WHEA / corruption mémoire : 0,00%. Restauration complète à l'état d'usine en 1 clic en 3,2 ms.",
    safetyNote:
      "Toutes les valeurs sont bornées statiquement par des types Rust validés et vérifiées contre `nvmlDeviceGetPowerManagementLimitConstraints` avant appel FFI.",
  },

  // === KPI & TÉLÉMÉTRIE GLOBALE ===
  kpi_power: {
    key: "kpi_power",
    title: "Puissance Système DC vs Prise Murale AC (Loi CMOS P = C·V²·f + P_fuite)",
    subsystem: "Télémétrie Énergétique",
    privilege: "both",
    winApi: "Windows EMI (Energy Meter Interface) + RAPL MSR_PKG_ENERGY_STATUS + nvmlDeviceGetPowerUsage",
    summary:
      "Somme temps réel de tous les rails internes (CPU Package, GPU Board, Chipset/PCIe, NVMe/SATA, Écran, NIC/USB) et puissance réelle tirée à la prise murale 230V AC après rendement de l'alimentation (80+ Gold : ~89% à mi-charge, ~83% à très faible charge).",
    physicsDetail:
      "La puissance dynamique d'une puce CMOS obéit à P_dyn = α · C · V² · f. Or, pour monter en fréquence f, il faut aussi monter la tension V quasi-linéairement : la puissance varie donc approximativement comme f^2,7 à f^3 ! Réduire la fréquence de seulement 25% réduit la tension requise de ~22% et fait chuter la puissance de plus de 54%. De plus, le courant de fuite P_leak décroît exponentiellement quand la température baisse (-15°C ≈ -4 à -8 W supplémentaires gratuits).",
    beforeAfterHint:
      "Chaque tranche de 50 W économisée 10 h/jour économise 182,5 kWh/an (~45,9 €/an au tarif réglementé 0,2516 €/kWh) et évite autant de chaleur rejetée dans la pièce en été.",
    safetyNote:
      "Les compteurs d'énergie EMI Windows 11 et NVML sont lus à 1 Hz (coût CPU < 0,02%) sans réveiller les cœurs endormis.",
  },

  kpi_temp: {
    key: "kpi_temp",
    title: "Températures Silicium (Package CPU, GPU Core/Hotspot, NVMe SMART) & Marge TjMax",
    subsystem: "Thermique",
    privilege: "both",
    winApi: "ThermalZone WMI / PawnIO DTS + nvmlDeviceGetTemperature + IOCTL_STORAGE_QUERY_PROPERTY (SMART)",
    summary:
      "Mesure les jonctions thermiques critiques et la distance de sécurité jusqu'à `TjMax` (100°C sur CPU moderne). Selon la loi de Fourier ΔT = P · R_th, diviser par deux les watts dissipés divise presque par deux l'élévation de température au-dessus de l'air ambiant (22°C).",
    physicsDetail:
      "La dégradation par électromigration (équation de Black) double environ tous les +10°C. Faire tourner un CPU à 43°C au lieu de 72°C et un SSD NVMe à 35°C au lieu de 56°C prolonge drastiquement la durée de vie des condensateurs VRM, de la pâte thermique et du contrôleur flash.",
    beforeAfterHint:
      "Sous 50–52°C, la quasi-totalité des cartes graphiques modernes coupent totalement leurs ventilateurs (mode 0 RPM Fan-Stop) : usure mécanique des roulements réduite à zéro.",
    safetyNote:
      "Les protections thermiques matérielles PROCHOT# et THERMTRIP# restent 100% actives et intouchées.",
  },

  kpi_fan_noise: {
    key: "kpi_fan_noise",
    title: "Vitesse Ventilation (RPM) & Niveau Acoustique Combiné en dBA (Loi des Ventilateurs)",
    subsystem: "Acoustique & PWM",
    privilege: "both",
    winApi: "nvmlDeviceGetFanSpeed_v2 + SuperIO/EC Read-Only Telemetry",
    summary:
      "Même sans toucher manuellement aux courbes PWM du BIOS, abaisser les watts fait chuter la température sous les paliers d'accélération des ventilateurs CPU, GPU et boîtier. Les sources sonores s'additionnent de manière logarithmique : L_tot = 10 · log10(Σ 10^(L_i/10)).",
    physicsDetail:
      "D'après les lois d'affinité aérodynamiques, le bruit d'un ventilateur varie en 50 · log10(RPM_2 / RPM_1) : diviser les RPM par 2 réduit le bruit d'environ -15 dBA ! En psychoacoustique, -10 dBA correspond à un volume ressenti DEUX FOIS plus silencieux par l'oreille humaine. En dessous de 24 dBA, le PC se fond dans le bruit de fond d'une chambre calme.",
    beforeAfterHint:
      "Typique en charge mixte : 1750 RPM (39,5 dBA, souffle très audible) → 680 RPM + GPU 0 RPM (22,8 dBA, quasi inaudible à 60 cm).",
    safetyNote:
      "EcoClock ne force jamais l'arrêt d'un ventilateur sur un composant chaud : le silence est obtenu naturellement en supprimant la chaleur à la source !",
  },

  kpi_latency_ms: {
    key: "kpi_latency_ms",
    title: "Effets Réels Mesurés en Millisecondes (Perception Humaine vs Fréquence Brute)",
    subsystem: "Benchmarks Réels",
    privilege: "both",
    winApi: "QueryPerformanceCounter (résolution < 100 ns) + charges réelles LZ4 / JSON / UI / I/O 4K",
    summary:
      "Les scores synthétiques abstraits trompent l'utilisateur : EcoClock mesure le temps RÉEL en millisecondes (ms) d'opérations concrètes du quotidien avant et après underclocking, comparé aux seuils physiologiques humains.",
    physicsDetail:
      "Seuils neuro-visuels établis (Nielsen / Rail Model) : < 16,67 ms = 1 image à 60 Hz (totalement fluide, 0 saccade) ; < 50 ms = perçu comme instantané lors d'une frappe clavier ou d'un clic ; > 100 ms = début de perception d'un léger délai. Passer un parsing JSON de 5,8 ms à 8,4 ms (+2,6 ms) est biologiquement indétectable, alors qu'il économise 45% d'électricité CPU !",
    beforeAfterHint:
      "De nombreuses tâches modernes sont limitées par la latence DRAM (~65 ns) ou le réseau (~15 ms), et non par les derniers MHz du CPU : underclocker de -30% ne les ralentit parfois que de +9 à +14%.",
    safetyNote:
      "Le micro-benchmark intégré dure < 120 ms au total et n'échauffe pas les composants.",
  },

  // === CONTRÔLES CPU ===
  cpu_freq_cap: {
    key: "cpu_freq_cap",
    title: "Plafond de Fréquence Processeur (PROCFREQMAX en MHz)",
    subsystem: "CPU (P-Cores & E-Cores)",
    privilege: "user",
    winApi: "powrprof.dll → PowerWriteACValueIndex(SUB_PROCESSOR, PROCFREQMAX 75b0ae3f-bce0-45a7-8c89-c9611c25e100)",
    summary:
      "Fixe la limite supérieure exacte en MHz que le gouverneur matériel (Intel Speed Shift HWP / AMD CPPC2) est autorisé à demander. Le processeur reste libre de descendre à 400–800 MHz au repos, mais ne franchira jamais ce plafond.",
    physicsDetail:
      "Sur un CPU moderne 5,2 GHz, la courbe tension/fréquence (V/F) est douce de 800 MHz (0,68 V) à 3 600 MHz (0,96 V), puis explose verticalement entre 4 200 MHz et 5 200 MHz (1,38 V+) pour franchir les délais de propagation des portes logiques. Plafonner à 3 200–3 600 MHz coupe toute la zone exponentielle de V².",
    beforeAfterHint:
      "5200 MHz (1360 mV, 92 W en charge) → 3400 MHz (940 mV, 31 W en charge) : -66% de watts CPU, -24°C, tandis qu'une ouverture de document passe de 14 ms à 19,5 ms (+5,5 ms).",
    safetyNote:
      "API Windows standard en espace utilisateur. Effet immédiat (< 2 ms) après `PowerSetActiveScheme`, zéro redémarrage requis.",
  },

  cpu_max_pct: {
    key: "cpu_max_pct",
    title: "État Maximal du Processeur (% de la fréquence de base)",
    subsystem: "CPU",
    privilege: "user",
    winApi: "powrprof.dll → SUB_PROCESSOR / PROCTHROTTLEMAX (bc5038f7-23e0-4960-96da-33abaf5935ec)",
    summary:
      "Limite le P-State maximal en pourcentage de la fréquence nominale (base clock). Astuce célèbre sous Windows : passer de 100% à 99% désactive instantanément le Turbo Boost/Precision Boost Overdrive sur la majorité des pilotes ACPI, et descendre à 60–80% force les P-States très basse tension.",
    physicsDetail:
      "Agit conjointement avec `PROCFREQMAX` : le noyau NT applique le minimum strict `min(BaseClock × MaxPct, FreqCapMHz)`. Très utile sur les PC portables ou CPU verrouillés où `PROCFREQMAX` est parfois arrondi par le firmware UEFI.",
    beforeAfterHint:
      "100% → 80% sur une base 3,6 GHz plafonne à ~2,88 GHz (VID ~0,84 V), ramenant un CPU 125 W sous la barre des 26 W même sous compilation multi-cœurs !",
    safetyNote:
      "100% réversible en mode User standard. Ne descend jamais sous le P-State minimum matériel (Pn/LFM).",
  },

  cpu_min_pct: {
    key: "cpu_min_pct",
    title: "État Minimal du Processeur (Descente libre en LFM au repos)",
    subsystem: "CPU",
    privilege: "user",
    winApi: "powrprof.dll → SUB_PROCESSOR / PROCTHROTTLEMIN (893dee8e-2bef-41e0-89c6-b55d0929964c)",
    summary:
      "Le profil Windows « Performances élevées » verrouille absurdement ce réglage à 100%, interdisant au CPU de descendre à 800 MHz même quand vous lisez une page statique ! Le maintenir à 5% autorise la fréquence plancher LFM (Lowest Frequency Mode).",
    physicsDetail:
      "En LFM (600–800 MHz, ~0,65 V), les boucles PLL et arbres d'horloge consomment 6 fois moins qu'à 4,8 GHz lors des micro-réveils système (souris, curseur clignotant, télémétrie réseau).",
    beforeAfterHint:
      "100% → 5% au bureau : -12 à -22 W immédiats au repos, -9°C, et temps de remontée en fréquence par Intel HWP / AMD CPPC2 de seulement 1,0 ms (matériel) !",
    safetyNote:
      "Valeur recommandée : 5% dans absolument tous les profils, y compris jeu.",
  },

  cpu_turbo: {
    key: "cpu_turbo",
    title: "Politique Turbo Boost / Precision Boost (PERFBOOSTMODE)",
    subsystem: "CPU",
    privilege: "user",
    winApi: "powrprof.dll → SUB_PROCESSOR / PERFBOOSTMODE (be337238-0d82-4146-a960-4f3749d470c7)",
    summary:
      "Contrôle l'algorithme d'opportunité de surfréquence au-dessus de la fréquence de base : `Agressif` (défaut Windows, grimpe au max au moindre mouvement de souris), `Efficient Enabled` (n'active le boost que si la charge reste soutenue et rentable), ou `Désactivé` (reste strictement ≤ fréquence de base).",
    physicsDetail:
      "Les pics de Turbo Boost à 1,40 V+ pendant 80 ms lors de l'ouverture d'un onglet créent des pointes thermiques locales (+18°C en 0,2 s) qui font « vrombir » inutilement le ventilateur CPU. Désactiver le Turbo supprime 100% de ces pics de tension et de ventilation !",
    beforeAfterHint:
      "Agressif → Désactivé : supprime les pointes à 1,42 V, économise 18–45 W en usage actif, élimine totalement le yo-yo du ventilateur CPU, impact navigation web : +3,5 ms.",
    safetyNote:
      "Sur certaines installations Windows, l'attribut `ATTRIB_HIDE` masque cette option dans le panneau de configuration, mais l'écriture directe via son GUID fonctionne nativement.",
  },

  cpu_epp: {
    key: "cpu_epp",
    title: "Préférence Énergétique Matérielle EPP (Intel Speed Shift / AMD CPPC2)",
    subsystem: "CPU (Microcode PMU)",
    privilege: "user",
    winApi: "powrprof.dll → SUB_PROCESSOR / PERFEPP (36687f9e-e3a5-4dbf-b1dc-15eb381c6863) → IA32_HWP_REQUEST[31:24]",
    summary:
      "Paramètre de 0% (performance pure) à 100% (sobriété maximale) écrit directement dans le registre matériel HWP/CPPC de chaque cœur. La PMU interne du processeur arbitre toutes les 1 milliseconde le meilleur couple tension/fréquence.",
    physicsDetail:
      "À EPP = 0–20%, une micro-tâche de fond de 2 ms fait bondir le cœur à 5 GHz. À EPP = 70–85%, le microcode exécute les tâches courtes sur le point d'efficacité maximale (point d'inflexion V/F ~1,8–2,4 GHz, rendement instructions/joule optimal) et ne monte que si la file d'exécution sature.",
    beforeAfterHint:
      "EPP 20% → 80% en bureautique/dev : -11 W moyens, -7°C, temps de réaction d'un clic UI : +1,8 ms (strictement imperceptible).",
    safetyNote:
      "Géré de manière autonome par le firmware interne du processeur, latence d'adaptation 1 ms.",
  },

  cpu_core_parking: {
    key: "cpu_core_parking",
    title: "Core Parking (Cœurs Actifs Minimaux — Mise en veille profonde des cœurs inutilisés)",
    subsystem: "CPU (Topologie Cœurs)",
    privilege: "admin",
    winApi: "powrprof.dll → SUB_PROCESSOR / CPMINCORES (0cc5b647-c1df-4637-891a-dec35c318583) [Admin: unhide]",
    summary:
      "Autorise l'ordonnanceur Windows à « parquer » les cœurs superflus en état C6/C7 (alimentation coupée par power-gating transistor) et à regrouper les threads légers sur un petit nombre de cœurs efficaces au lieu de réveiller les 16 cœurs en permanence.",
    physicsDetail:
      "Un cœur parqué en C6 voit sa tension de rail coupée à ~0,0 V (fuite quasi nulle, < 0,05 W/cœur) et son cache L1/L2 vidé dans le LLC. Parquer 75% des cœurs au repos permet aussi au package entier d'entrer plus souvent en état profond Pkg-C8.",
    beforeAfterHint:
      "100% actifs → 25% actifs en veille/bureau : -5 à -9 W, temps de dé-parquage d'un cœur si une grosse charge survient : ~0,35 ms.",
    safetyNote:
      "Dès que la charge CPU dépasse le seuil d'occupation (65%), Windows réveille automatiquement tous les cœurs en moins d'une milliseconde.",
  },

  cpu_cstates: {
    key: "cpu_cstates",
    title: "États de Sommeil Profonds C-States (C6 / C8 / C10 Power Gating)",
    subsystem: "CPU Package",
    privilege: "user",
    winApi: "powrprof.dll → SUB_PROCESSOR / IDLEDISABLE (5d76a2ca-e8c0-402f-a133-2158492d58ad) = 0",
    summary:
      "Permet aux cœurs inactifs entre deux interruptions de couper leur horloge (C1E) puis leur tension d'alimentation complète via des transistors de coupure haute-résistance (C6/C8/C10).",
    physicsDetail:
      "Même quand Windows affiche 2% d'utilisation CPU, le processeur est inactif 98% de chaque seconde. Sans C-States profonds, il attend en C0/C1 en brûlant 24 W de courant statique. Avec C8/C10 activés (et ASPM PCIe compatible), le CPU Package tombe à 2,5–5 W au repos !",
    beforeAfterHint:
      "C-States désactivés → C8/C10 actifs : résidence profonde passe de 0% à 88% au bureau, -16 W au repos, latence de sortie C8 : ~0,12 ms (120 µs).",
    safetyNote:
      "Fonctionnalité native ACPI. Seuls les studios audio temps-réel extrêmes (buffer ASIO < 32 samples) ont parfois besoin de les limiter.",
  },

  cpu_pl1: {
    key: "cpu_pl1",
    title: "Enveloppe Thermique Maximale Package PL1 / PPT (Plafond strict en Watts)",
    subsystem: "CPU (RAPL / Firmware)",
    privilege: "admin",
    winApi: "PowerCfg Processor Power Limit / Intel DPTF / AMD PMF (Droits Administrateur)",
    summary:
      "Impose un budget électrique absolu en Watts au package processeur entier. Même si vous lancez un rendu vidéo 3D ou une compilation Rust sur 100% des threads, le CPU ajustera instantanément sa fréquence pour ne JAMAIS dépasser ce nombre de Watts.",
    physicsDetail:
      "L'unité RAPL (Running Average Power Limit) intègre l'énergie consommée chaque milliseconde et régule les P-States en boucle fermée. Passer un CPU de 125 W à 45 W conserve typiquement 76% de ses performances multicœurs (grâce à la loi cubique) tout en divisant la chaleur par 2,8 !",
    beforeAfterHint:
      "PL1 125 W → 45 W en pleine charge : CPU bloqué à 45,0 W max, température plafonnée à 51°C au lieu de 89°C, ventilateur à 820 RPM au lieu de 2150 RPM.",
    safetyNote:
      "Requiert le mode Administrateur. Borné entre 15 W (plancher sécurité) et 125 W (TDP nominal).",
  },

  bg_ecoqos: {
    key: "bg_ecoqos",
    title: "Windows 11 EcoQoS (Mode Efficacité sur les processus d'arrière-plan)",
    subsystem: "Ordonnanceur NT",
    privilege: "user",
    winApi: "kernel32.dll → SetProcessInformation(ProcessPowerThrottling, PROCESS_POWER_THROTTLING_EXECUTION_SPEED)",
    summary:
      "Applique l'indicateur `EcoQoS` aux processus non-interactifs appartenant à l'utilisateur courant (indexeurs, updaters, launchers de jeux réduits, onglets inactifs) : Windows les confine sur les E-Cores à basse fréquence sans ralentir la fenêtre au premier plan !",
    physicsDetail:
      "Sur architecture hybride (Intel P+E ou AMD dense cores), un E-Core à 1,6 GHz consomme 4,5 fois moins d'énergie par instruction qu'un P-Core à 4,8 GHz pour exécuter une synchronisation cloud ou une mise à jour en tâche de fond.",
    beforeAfterHint:
      "Désactivé → Activé : -4 à -9 W lors du multitâche, +0,0 ms sur votre application active au premier plan (qui conserve la priorité normale).",
    safetyNote:
      "N'affecte que les processus du même utilisateur (`PROCESS_SET_INFORMATION`), exclut automatiquement l'audio, la fenêtre active et les processus système critiques.",
  },

  // === CONTRÔLES GPU ===
  gpu_power_limit: {
    key: "gpu_power_limit",
    title: "Limite de Puissance Carte Graphique (GPU Power Limit % TDP via NVML)",
    subsystem: "GPU Dédié",
    privilege: "admin",
    winApi: "nvml.dll → nvmlDeviceSetPowerManagementLimit(device, milliwatts) [Admin requis par le pilote]",
    summary:
      "Réduit le plafond de puissance totale de la carte graphique (GPU + GDDR6 + VRM) en pourcentage du TDP constructeur. Le contrôleur GPU Boost ajuste dynamiquement le couple fréquence/tension optimal à chaque milliseconde.",
    physicsDetail:
      "Les GPU modernes sont poussés en usine bien au-delà de leur point de rendement optimal : passer de 220 W (100%) à 150 W (68%) ne fait perdre que ~6 à 8% de FPS en jeu ! Descendre à 45–55% (~100 W) transforme une carte vorace en carte ultra-fraîche et silencieuse.",
    beforeAfterHint:
      "100% (220 W, 76°C, 1950 RPM) → 65% (143 W, 57°C, 1050 RPM) : -77 W, -19°C, temps d'image 3D passe de 8,2 ms à 9,1 ms (+0,9 ms, soit 122 → 110 FPS !).",
    safetyNote:
      "EcoClock interroge d'abord `nvmlDeviceGetPowerManagementLimitConstraints(min, max)` et refuse toute valeur hors de la plage certifiée par le VBIOS.",
  },

  gpu_clock_cap: {
    key: "gpu_clock_cap",
    title: "Plafond de Fréquence Cœur GPU (GPU Locked Clocks Min..Max MHz)",
    subsystem: "GPU Dédié",
    privilege: "admin",
    winApi: "nvml.dll → nvmlDeviceSetGpuLockedClocks(device, minClockMHz=210, maxClockMHz=cap)",
    summary:
      "Équivalent exact de `nvidia-smi -lgc 210,<CAP>` : autorise le GPU à descendre à 210 MHz (état P8, 0,64 V) au repos, mais lui interdit de monter au-delà de `<CAP>` MHz en charge 3D/vidéo/IA locale.",
    physicsDetail:
      "Même avec un Power Limit bas, une charge 3D légère (interface accélérée, vidéo upscalée, jeu 2D) peut faire bondir le GPU à 2610 MHz @ 1,08 V. Plafonner à 1500–1850 MHz bloque la tension Vgpu autour de 0,78–0,85 V, divisant par plus de deux l'énergie par image calculée.",
    beforeAfterHint:
      "2610 MHz → 1650 MHz : Vgpu chute de 1075 mV à 805 mV (-44% d'énergie dynamique par shader), température -14°C, décodage/compositing DWM reste < 4 ms.",
    safetyNote:
      "Réinitialisé proprement via `nvmlDeviceResetGpuLockedClocks(device)` lors du retour au profil Nominal ou à la fermeture.",
  },

  gpu_vram_policy: {
    key: "gpu_vram_policy",
    title: "Politique d'États Mémoire Vidéo GDDR6/GDDR6X (P8 / P5 / P0)",
    subsystem: "GPU (Contrôleur VRAM)",
    privilege: "admin",
    winApi: "nvml.dll → nvmlDeviceSetMemoryLockedClocks / NVAPI P-State Policy",
    summary:
      "La mémoire GDDR6/GDDR6X est l'un des pires gaspilleurs cachés d'un PC : à pleine vitesse (P0, 10 500 MHz), les puces mémoire et le contrôleur IMC brûlent à eux seuls 18 à 32 W ! En état P8 (405 MHz), ils tombent sous 3 W.",
    physicsDetail:
      "Avec un écran à 165 Hz ou en multi-écrans, l'intervalle VBLANK est parfois trop court pour recalibrer l'horloge mémoire sans artefact : le pilote bloque alors la VRAM en P0 à 100% même sur le Bureau Windows ! Coupler la politique P8/P5 avec un rafraîchissement 60/120 Hz libère instantanément 12 à 20 W.",
    beforeAfterHint:
      "VRAM bloquée P0 (28 W au repos, GPU 53°C ventilateurs actifs) → P8 Idle 405 MHz (8 W au repos, GPU 34°C, 0 RPM Fan-Stop permanent).",
    safetyNote:
      "La transition P8 → P0 à l'ouverture d'une application 3D prend ~0,8 ms et reste gérée sans artefact par le VBIOS.",
  },

  gpu_zero_rpm: {
    key: "gpu_zero_rpm",
    title: "Mode Semi-Passif 0 RPM (Arrêt total des ventilateurs GPU sous 52°C)",
    subsystem: "GPU (Thermique & Bruit)",
    privilege: "user",
    winApi: "NVML Fan Cooler Policy (AUTO Zero-RPM Hysteresis 46°C..52°C)",
    summary:
      "Autorise la politique semi-passive automatique du VBIOS : tant que le cœur GPU reste sous 52°C (avec hystérésis de réarrêt à 46°C pour éviter les démarrages/arrêts répétés), les ventilateurs restent à 0 RPM (0 dBA, 0 W moteur).",
    physicsDetail:
      "Sans underclocking, une carte graphique stagne souvent à 53–56°C au bureau et fait tourner ses ventilateurs à 1000 RPM inutilement. En abaissant la conso repos de 26 W à 9 W, le radiateur dissipe tout par convection naturelle à 35°C.",
    beforeAfterHint:
      "1050 RPM (27 dBA) → 0 RPM (silence absolu + économie de ~2,5 W des moteurs brushless + zéro poussière aspirée dans le radiateur).",
    safetyNote:
      "Dès que la température franchit 52°C, la courbe automatique constructeur reprend immédiatement la main.",
  },

  igpu_eco: {
    key: "igpu_eco",
    title: "Mode Sobriété iGPU (Processeur Graphique Intégré Intel Graphics / AMD Radeon)",
    subsystem: "iGPU / SoC",
    privilege: "user",
    winApi: "powrprof.dll → GUID_INTEL_GRAPHICS_SUBGROUP (44f3beca-a7c0-460e-9df2-bb8b99e0cba6) = Max Battery",
    summary:
      "Favorise les fréquences basses (300–600 MHz au lieu de 1550 MHz) et l'état de veille RC6 sur le circuit graphique intégré lors du rendu bureautique, du navigateur et du décodage vidéo matériel AV1/HEVC.",
    physicsDetail:
      "Les décodeurs vidéo matériels fixes (QuickSync / VCN) décodent de la 4K60 à 400 MHz en consommant à peine 1,2 W. Laisser l'iGPU booster à 1,5 GHz lors du défilement d'une page web gaspille 4 à 7 W dans le rail Uncore/GT.",
    beforeAfterHint:
      "Performances max → Sobriété iGPU : -2,5 à -6 W en lecture vidéo/web, défilement 60 Hz toujours fluide (< 5 ms/frame).",
    safetyNote:
      "Paramètre standard de plan d'alimentation Windows, accessible en mode Utilisateur.",
  },

  // === BUS PCIe & STOCKAGE ===
  pcie_aspm: {
    key: "pcie_aspm",
    title: "PCIe ASPM (Active State Power Management : L0 → L0s → L1 → Sous-états L1.2)",
    subsystem: "Bus PCIe & Chipset",
    privilege: "both",
    winApi: "powrprof.dll → SUB_PCIEXPRESS (501a4d13-42af-4429-9fd1-a8218c268e20) / ASPM (ee12f906-...)",
    summary:
      "Éteint les lignes différentielles haute fréquence (SerDes 16 GT/s) des ports PCIe (GPU x16, SSD NVMe x4, carte Wi-Fi x1) entre deux paquets de données. En sous-état L1.2, même l'horloge de référence `CLKREQ#` 100 MHz et les PLL sont coupées !",
    physicsDetail:
      "Un lien PCIe Gen4 x16 bloqué en L0 fait osciller 32 paires différentielles à 16 GHz en continu même pour transférer 0 octet/s, brûlant ~6 à 9 W ET empêchant physiquement le CPU d'atteindre les états C8/C10 (effet domino de +8 W supplémentaires) ! En L1.2, le lien tombe sous 0,02 W.",
    beforeAfterHint:
      "ASPM Désactivé → L1.2 Substates : -7 à -13 W totaux (PCIe + déblocage Pkg-C8 CPU), latence de réveil du lien L1.2 : ~0,045 ms (45 µs, totalement invisible).",
    safetyNote:
      "L0s et L1 sont modifiables en User (`Économie modérée/maximale`) ; le forçage fin des sous-états L1.2 requiert Admin.",
  },

  nvme_apst: {
    key: "nvme_apst",
    title: "NVMe APST (Autonomous Power State Transition : PS0 → PS1 → PS3 → PS4)",
    subsystem: "Stockage SSD NVMe",
    privilege: "admin",
    winApi: "powrprof.dll → SUB_DISK / NVMe NOPPME & Primary/Secondary Idle Timeout (d639518a-e56d-4345-8af2-b9f32fb26109)",
    summary:
      "Un SSD NVMe Gen4 moderne dispose de 5 états d'énergie internes : PS0 (pleine vitesse, 6,5–8,5 W), PS1 (3,5 W), PS3 (veille sans I/O, 0,05 W = 50 mW) et PS4 (sommeil profond, 0,005 W = 5 mW !). APST fait basculer le contrôleur automatiquement dès la fin d'un accès disque.",
    physicsDetail:
      "Quand APST est désactivé (souvent en profil « Performances »), le contrôleur ARM multi-cœurs du SSD chauffe à 54–62°C à ne rien faire. En PS4, le SSD consomme 1 200 fois moins qu'en PS0 et redescend à 32–35°C.",
    beforeAfterHint:
      "PS0 permanent (5,8 W repos, 55°C) → PS4 Deep (0,02 W repos, 33°C, -22°C sur le SSD !). Coût sur la TOUTE PREMIÈRE lecture après inactivité : 0,06 ms → 1,85 ms (+1,79 ms), puis retour plein débit 7 000 Mo/s en PS0.",
    safetyNote:
      "Zéro perte de données ni usure flash : APST agit uniquement sur les horloges du contrôleur et de la DRAM cache du SSD.",
  },

  nvme_timeout: {
    key: "nvme_timeout",
    title: "Délai d'Inactivité NVMe avant Transition Veille (Idle Timeout en ms)",
    subsystem: "Stockage SSD NVMe",
    privilege: "admin",
    winApi: "powrprof.dll → SUB_DISK / NVME_IDLE_TIMEOUT (d639518a-e56d-4345-8af2-b9f32fb26109)",
    summary:
      "Durée de silence I/O (en millisecondes) exigée avant que le SSD NVMe ne descende en état de veille PS3/PS4. Un délai court (100 ms) maximise le temps passé à 5 mW ; un délai plus long (500–1000 ms) évite les allers-retours pendant une compilation intensive.",
    physicsDetail:
      "Windows regroupe naturellement les écritures du cache NTFS par rafales. Avec un timeout de 100–200 ms, le SSD dort plus de 94% du temps en bureautique tout en restant éveillé en PS0 pendant toute la durée d'une copie de fichier ou d'un chargement de niveau.",
    beforeAfterHint:
      "1000 ms → 100 ms : +1,4 W économisé en usage bureautique intermittent, -5°C sur le contrôleur NVMe.",
    safetyNote:
      "Borné ≥ 50 ms pour éviter tout cyclage excessif des états d'énergie (thrashing).",
  },

  sata_alpm: {
    key: "sata_alpm",
    title: "SATA ALPM (Aggressive Link Power Management : Active / HIPM / DIPM Slumber)",
    subsystem: "Stockage SATA & AHCI",
    privilege: "admin",
    winApi: "powrprof.dll → SUB_DISK / AHCI Link Power Management HIPM/DIPM (0b2d69d7-a2a1-449c-9680-f91c70521c60)",
    summary:
      "Met en sommeil (`Partial` ou `Slumber`) l'interface PHY SATA 6 Gb/s du contrôleur AHCI de la carte mère et des SSD/HDD secondaires lorsqu'aucune commande NCQ n'est en cours. DIPM permet au disque d'initier lui-même la mise en veille.",
    physicsDetail:
      "Même sans disque dur mécanique, un contrôleur SATA maintenu en état `Active` empêche parfois le PCH (chipset carte mère) d'entrer en état basse consommation SLP_S0, gaspillant 1,5 à 3,5 W.",
    beforeAfterHint:
      "Active → DIPM Slumber : -1,8 à -3,2 W, latence de sortie d'état Slumber : ~3,2 ms (uniquement sur disques SATA secondaires).",
    safetyNote:
      "Supporté nativement par le pilote Microsoft `storahci.sys` sur tous les SSD/HDD modernes.",
  },

  // === AFFICHAGE, RÉSEAU, USB & TIMER ===
  display_hz: {
    key: "display_hz",
    title: "Fréquence de Rafraîchissement Écran (Hz) & Effet Caché sur la VRAM GPU",
    subsystem: "Affichage & DWM",
    privilege: "user",
    winApi: "user32.dll → EnumDisplaySettingsW + ChangeDisplaySettingsExW(CDS_UPDATEREGISTRY | 0)",
    summary:
      "Bascule instantanément le moniteur entre 165 Hz, 120 Hz, 75 Hz et 60 Hz sans modifier la résolution native. C'est l'un des leviers les plus rentables en bureautique car il agit à la fois sur le scaler de l'écran, le compositeur Windows DWM ET le contrôleur mémoire du GPU !",
    physicsDetail:
      "À 165 Hz en 1440p/4K, le GPU doit scanner le framebuffer 2,75 fois plus souvent par seconde (bande passante DisplayPort ~22 Gb/s au lieu de 8 Gb/s) et maintient souvent sa VRAM GDDR6 en état P0/P2 (+14 W !). Passer à 60 Hz libère le VBLANK, fait plonger la VRAM en P8, et économise en plus 4 à 8 W dans l'électronique du moniteur.",
    beforeAfterHint:
      "165 Hz → 60 Hz au bureau : -12 à -21 W combinés (GPU + écran) ! Intervalle entre images : 6,06 ms → 16,67 ms (parfait pour coder, lire, vidéo 24/30/60 fps).",
    safetyNote:
      "EcoClock vérifie d'abord la liste exacte des modes supportés via `EnumDisplaySettingsW` et teste avec `CDS_TEST` avant d'appliquer.",
  },

  display_brightness: {
    key: "display_brightness",
    title: "Luminosité Rétroéclairage Écran (WMI interne / DDC-CI I²C moniteur externe)",
    subsystem: "Affichage",
    privilege: "user",
    winApi: "WmiSetBrightness (portable) + dxva2.dll → SetVCPFeature(0x10 Luminance) via DDC/CI",
    summary:
      "Pilote directement le rétroéclairage LED de la dalle interne (portable) ou d'un moniteur de bureau compatible DDC/CI via le canal auxiliaire DisplayPort/HDMI, sans filtre logiciel sombre factice.",
    physicsDetail:
      "Le rétroéclairage LED représente 75% de la consommation d'un écran et varie de façon strictement linéaire avec le rapport cyclique PWM/DC. Passer de 100% (350 cd/m², éblouissant en intérieur) à 45% (150 cd/m², norme ISO sRGB confort visuel) économise 10 à 18 W réels à la prise !",
    beforeAfterHint:
      "100% (34 W écran) → 45% (18 W écran) : -16 W réels, +0,00 ms d'impact performance (zéro coût CPU/GPU), fatigue oculaire réduite.",
    safetyNote:
      "Commande matérielle VCP 0x10 standard VESA MCCS, 100% accessible en mode Utilisateur.",
  },

  nic_eee: {
    key: "nic_eee",
    title: "Ethernet Éco-Énergétique IEEE 802.3az (EEE Low-Power Idle + Auto-Downshift)",
    subsystem: "Réseau Filaire NIC",
    privilege: "admin",
    winApi: "NetAdapterAdvancedProperty / NDIS OID_PM_PARAMETERS (*EEE = 1, *GreenEthernet = 1)",
    summary:
      "Met les émetteurs-récepteurs cuivre RJ45 (1 GbE / 2.5 GbE) en mode Low-Power Idle (LPI) entre deux trames Ethernet. Les contrôleurs 2.5 GbE (Intel I225/I226, Realtek RTL8125) chauffent étonnamment sans EEE.",
    physicsDetail:
      "En Ethernet standard, des symboles `IDLE` sont transmis à pleine puissance 100% du temps sur les 4 paires torsadées même sans trafic. Avec 802.3az, l'émetteur s'éteint après quelques microsecondes de silence et n'envoie qu'une courte impulsion de rafraîchissement toutes les 20 ms.",
    beforeAfterHint:
      "EEE OFF → EEE ON (carte 2.5 GbE) : -1,8 à -3,2 W, latence ajoutée au ping réseau : ~0,018 ms (18 µs : un ping de 12,00 ms passe à 12,02 ms !).",
    safetyNote:
      "Norme IEEE standard négociée automatiquement avec votre box/switch (fallback transparent si le switch est ancien).",
  },

  wifi_psp: {
    key: "wifi_psp",
    title: "Économie Radio Wi-Fi 802.11 (CAM → Medium PSP → Max Power Save Polling)",
    subsystem: "Réseau Sans-Fil WLAN",
    privilege: "user",
    winApi: "powrprof.dll → SUB_WIRELESS (19cbb8fa-5279-450e-9fac-8a3d5fedd0c1) / Power Saving Mode",
    summary:
      "En mode CAM (Constantly Awake Mode), l'amplificateur radio Wi-Fi écoute le canal 2,4/5/6 GHz en continu. En mode PSP (Power Save Polling / TWT Wi-Fi 6), la puce éteint sa chaîne RF entre les balises DTIM du routeur qui bufferise les paquets entrants.",
    physicsDetail:
      "Éteindre le LNA et le synthétiseur RF 5/6 GHz entre les trames beacons fait chuter la consommation du module M.2 Wi-Fi de ~2,6 W à ~0,25 W et réduit aussi les interruptions PCIe qui réveillent le CPU.",
    beforeAfterHint:
      "CAM → Max PSP : -2,2 W ; débit téléchargement inchangé (réveil continu pendant un flux actif), gigue sur le 1er paquet ping : +2,8 ms (déconseillé uniquement en FPS compétitif).",
    safetyNote:
      "Paramètre standard de plan d'alimentation Windows, bascule instantanée en mode User.",
  },

  usb_suspend: {
    key: "usb_suspend",
    title: "Suspension Sélective USB (État U2/U3 sur concentrateurs et périphériques inactifs)",
    subsystem: "Contrôleur xHCI USB",
    privilege: "user",
    winApi: "powrprof.dll → SUB_USB (2a737441-1930-4402-8d77-b2bebba308a3) / USBSELECTIVE (48e6b7a6-...)",
    summary:
      "Autorise le pilote `USBXHCI.SYS` à placer individuellement chaque port USB inactif (webcam éteinte, lecteur de carte SD, clé Bluetooth au repos, DAC inutilisé) en état suspendu U3 (< 2,5 mA) sans couper les ports actifs (clavier/souris).",
    physicsDetail:
      "Sans suspension sélective, le contrôleur xHCI interroge (polling SOF toutes les 125 µs en High-Speed) tous les périphériques branchés, maintenant l'accès DMA mémoire ouvert et empêchant le package CPU de descendre au-delà de C3/C6 !",
    beforeAfterHint:
      "OFF → ON : -1,5 à -4,5 W (périphériques + amélioration C-States CPU), réveil d'un périphérique suspendu : ~8 ms (n'affecte pas une souris en mouvement).",
    safetyNote:
      "Les périphériques HID déclarant `SelectiveSuspendEnabled=0` (certaines souris gaming) sont automatiquement respectés.",
  },

  timer_resolution: {
    key: "timer_resolution",
    title: "Résolution du Timer Système Windows & Coalescing d'Interruptions (0,5 ms vs 15,625 ms)",
    subsystem: "Noyau NT (Horloge Tick)",
    privilege: "user",
    winApi: "ntdll.dll → NtQueryTimerResolution + SetProcessInformation(PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION)",
    summary:
      "Par défaut, l'horloge du noyau Windows bat toutes les 15,625 ms (64 Hz). Hélas, de nombreuses applications (Discord, launchers, Electron) appellent `timeBeginPeriod(1)` ou `0,5 ms`, forçant le CPU à se réveiller 2 000 fois par seconde au lieu de 64 fois !",
    physicsDetail:
      "Chaque interruption d'horloge sort un cœur de son sommeil profond C8, recharge les caches et consomme une bouffée d'énergie. Sous Windows 11 (22H2+), la résolution timer est isolée par processus et `IGNORE_TIMER_RESOLUTION` empêche les apps d'arrière-plan de marteler le CPU, permettant le regroupement (timer coalescing) à 15,625 ms.",
    beforeAfterHint:
      "Forcé 0,5 ms (2000 IRQ/s) → Coalescé 15,625 ms (64 IRQ/s) : -5 à -11 W au repos/bureau, résidence C8 grimpe de +24% ! Impact uniquement sur `Sleep(1)` des apps de fond.",
    safetyNote:
      "100% sûr : les applications audio WASAPI et la fenêtre de jeu au premier plan conservent leurs timers haute précision dédiés.",
  },

  // === BENCHMARKS EN MS ===
  bench_lz4: {
    key: "bench_lz4",
    title: "Benchmark Réel : Compression LZ4 + Hachage BLAKE3 d'un bloc mémoire de 64 Mo",
    subsystem: "Effet Réel CPU + Cache",
    privilege: "both",
    winApi: "Chronométrage QPC médian sur 5 passes (charge entière + SIMD + bande passante L3/DRAM)",
    summary:
      "Représente exactement ce que fait votre PC lorsqu'il décompresse une archive, charge les ressources d'une application, vérifie une mise à jour ou sauvegarde un gros projet.",
    physicsDetail:
      "Charge mixte 65% dépendante de la fréquence CPU et 35% limitée par le débit mémoire DDR4/DDR5. C'est pourquoi réduire la fréquence CPU de -40% n'augmente le temps d'exécution que d'environ +32%, tout en divisant l'énergie consommée par la tâche (en Joules = Watts × secondes) par deux !",
    beforeAfterHint:
      "~18 ms (Stock 5,2 GHz) → ~25 ms (Éco 3,2 GHz) : +7 ms d'écart — littéralement 14 fois plus court qu'un clignement d'œil humain (100 ms) !",
    safetyNote:
      "Mesure déterministe en mémoire vive, aucune écriture sur votre SSD.",
  },

  bench_json: {
    key: "bench_json",
    title: "Benchmark Réel : Parsing JSON Complexe (5 Mo) & Mise en Page Interface/Web",
    subsystem: "Effet Réel Single-Thread",
    privilege: "both",
    winApi: "Désérialisation arbre structuré + tri (représentatif navigation Web, IDE, bureautique)",
    summary:
      "Simule l'ouverture d'une page web riche, d'une réponse API ou d'une feuille de calcul. Sensible à la performance mono-cœur, au Turbo Boost et au paramètre EPP.",
    physicsDetail:
      "Fortement soumis aux prédictions de branchement et aux accès cache L1/L2. En dessous de 20 ms au total, aucune différence humaine n'existe entre un CPU à 5,2 GHz (1,40 V) et un CPU à 3,0 GHz (0,88 V).",
    beforeAfterHint:
      "~6,2 ms → ~9,4 ms (+3,2 ms) en profil Éco, ou ~15,8 ms (+9,6 ms) en profil Silence Absolu — reste instantané sous la barre d'une seule image 60 Hz !",
    safetyNote:
      "En Rust natif, exécuté via `serde_json` / parseur zéro-allocation calibré.",
  },

  bench_sqlite: {
    key: "bench_sqlite",
    title: "Benchmark Réel : Requête Indexée 50k Lignes / Compilation Incrémentale",
    subsystem: "Effet Réel Multi-Thread",
    privilege: "both",
    winApi: "Agrégation multi-threads + jointure en mémoire (sensible au PL1, Core Parking & FreqCap)",
    summary:
      "Représente une tâche productive soutenue : recherche locale dans vos mails/fichiers, filtre photo Lightroom, recalcul Excel lourd ou `cargo check` incrémental.",
    physicsDetail:
      "Montre honnêtement le compromis d'un underclocking très agressif : en profil Veille 1,1 GHz avec cœurs parqués, cette tâche passe de ~42 ms à ~125 ms (légèrement perceptible), alors qu'en profil Éco-Productivité elle reste à ~57 ms (+15 ms seulement) pour -55% de watts.",
    beforeAfterHint:
      "Idéal pour choisir entre le profil P1 (Silence Absolu) et P2 (Éco-Productivité) selon votre métier.",
    safetyNote:
      "Vous pouvez basculer entre les 5 profils en 1 clic (ou raccourci clavier) en moins de 4 ms si vous lancez un gros rendu.",
  },

  bench_gpu_frame: {
    key: "bench_gpu_frame",
    title: "Benchmark Réel : Temps de Rendu d'une Image GPU (Frame Time Shader 1080p/1440p)",
    subsystem: "Effet Réel GPU",
    privilege: "both",
    winApi: "D3D11 Timestamp Query (temps GPU en ms par image ; budget 60 FPS = 16,67 ms, 120 FPS = 8,33 ms)",
    summary:
      "Mesure le temps mis par la carte graphique pour dessiner une scène 3D standard. Tant que le temps par image reste inférieur à la période de votre écran (16,67 ms à 60 Hz, 8,33 ms à 120 Hz), vous avez 100% de fluidité sans aucune image perdue !",
    physicsDetail:
      "Calculer une image en 4,5 ms (222 FPS) sur un écran 60 Hz ou 120 Hz est un pur gaspillage thermique. Limiter le GPU pour qu'il la calcule en 7,2 ms économise 75 W et 20°C tout en restant parfaitement fluide à 120 FPS.",
    beforeAfterHint:
      "Jeu Sweet-Spot (PL 72%, 2050 MHz) : 6,4 ms → 7,3 ms (+0,9 ms), toujours sous les 8,33 ms du 120 Hz, avec -68 W et ventilateurs divisés par deux !",
    safetyNote:
      "L'accélération vidéo matérielle (YouTube 4K AV1, Netflix) utilise un bloc ASIC dédié et reste fluide même au réglage GPU minimal.",
  },

  bench_nvme_wake: {
    key: "bench_nvme_wake",
    title: "Benchmark Réel : Latence 1ère Lecture Aléatoire 4 Ko (Réveil NVMe APST + SATA)",
    subsystem: "Effet Réel Stockage",
    privilege: "both",
    winApi: "CreateFileW(FILE_FLAG_NO_BUFFERING) + ReadFile 4096 octets après période de repos",
    summary:
      "Mesure la pénalité exacte de réveil lorsque le SSD sort de son état de veille APST (PS1, PS3 ou PS4) pour servir le tout premier fichier après un moment d'inactivité. Toutes les lectures suivantes repassent immédiatement à 0,06 ms (PS0) !",
    physicsDetail:
      "Sortie de PS1 : ~0,12 ms. Sortie de PS3 : ~0,85 ms. Sortie de PS4 (sommeil profond 5 mW) : ~1,85 à 2,4 ms. À titre de comparaison, un ancien disque dur mécanique mettait 12 000 µs (12 ms) par accès et 4 000 ms pour relancer son moteur !",
    beforeAfterHint:
      "0,06 ms → 1,85 ms (+1,79 ms une seule fois au réveil) pour diviser la température du SSD de 55°C à 33°C et sa conso repos par 300.",
    safetyNote:
      "Insignifiant pour 99,9% des usages ; seul un serveur de base de données transactionnel OLTP préférera PS1.",
  },

  bench_bus_wake: {
    key: "bench_bus_wake",
    title: "Benchmark Réel : Réveil Lien PCIe ASPM L1.2 + Aller-Retour Réseau (EEE / Wi-Fi PSP)",
    subsystem: "Effet Réel Bus & Réseau",
    privilege: "both",
    winApi: "Latence combinée sortie PCIe L1.2 + PHY 802.3az LPI + 802.11 DTIM Poll",
    summary:
      "Additionne les micro-délais de réveil des bus d'interconnexion (PCIe ASPM), de la carte Ethernet (EEE) et du Wi-Fi (PSP) lors de l'envoi d'un paquet interactif après silence.",
    physicsDetail:
      "PCIe L1.2 ajoute ~0,045 ms (45 µs) et Ethernet EEE ajoute ~0,018 ms (18 µs) : tous deux totalement indétectables même en jeu e-sport ! En revanche, le Wi-Fi Max PSP ajoute ~2,8 ms de gigue moyenne (parfait en bureau/vidéo, à passer en CAM/Medium uniquement pour du jeu en ligne compétitif).",
    beforeAfterHint:
      "Filaire + ASPM L1.2 : +0,06 ms pour -10 W économisés (ratio rendement/latence imbattable : > 150 W économisés par milliseconde !).",
    safetyNote:
      "Détecté et ajusté automatiquement par les profils Jeu vs Bureau.",
  },

  // === OPTIMISEUR PARETO ===
  optimizer_pareto: {
    key: "optimizer_pareto",
    title: "Moteur d'Optimisation Front de Pareto (Rendement Watts économisés / ms ajouté)",
    subsystem: "Conseiller Intelligent",
    privilege: "both",
    winApi: "Modèle déterministe Rust embarqué (`src/optimizer.rs` — 0 cloud, 0 télémétrie externe, < 0,1 ms)",
    summary:
      "Inspecte chaque sous-système de votre configuration actuelle, simule l'effet marginal d'un ajustement vers le « genou » (sweet-spot) de la courbe V/F, et classe les propositions selon le ratio d'efficacité : gains électriques/thermiques/acoustiques divisés par la pénalité réelle en millisecondes.",
    physicsDetail:
      "Une configuration est dite « Pareto-optimale » lorsqu'on ne peut plus économiser de watts sans dégrader sensiblement la réactivité perçue. En premier viennent les économies « gratuites » (0 ms : écran 60 Hz en bureau, C-States, EcoQoS, ASPM L1.2, NVMe PS3, EEE), puis le rabotage de la zone survoltée du CPU et du GPU.",
    beforeAfterHint:
      "En moyenne, appliquer les propositions Pareto élimine 52 à 68% de la consommation totale et -14 dBA de bruit pour moins de +5 ms sur les tâches courantes.",
    safetyNote:
      "Chaque proposition peut être appliquée individuellement, testée en direct, ou annulée en restaurant le profil P5 Nominal.",
  },

  adaptive_mode: {
    key: "adaptive_mode",
    title: "Mode intelligent : bascule de profil selon le contexte",
    subsystem: "Automatisation",
    privilege: "both",
    winApi: "Inactivité (suivi des entrées côté Rust : GetLastInputInfo) + état batterie (GetSystemPowerStatus)",
    summary:
      "Des règles ordonnées choisissent le profil adapté : rendu lourd → jamais de bridage, jeu → équilibre, batterie → économie, inactivité → silence, sinon profil quotidien. La première règle qui correspond l'emporte.",
    physicsDetail:
      "Une économie n'est pas toujours utile : une fréquence réduite pendant une compilation allonge la durée de la tâche et peut consommer davantage d'énergie au total (énergie = puissance × temps). La porte de décision n'autorise donc une bascule que si le gain électrique dépasse un seuil minimal et si la latence ajoutée reste dans le budget choisi.",
    beforeAfterHint:
      "Exemple : en inactivité de 2 min, passage en P2 (≈ -20 W, +0,3 ms d'interface). Dès que vous bougez la souris, retour immédiat au profil quotidien.",
    safetyNote:
      "Stabilité : une cible doit être confirmée deux cycles de suite, et un délai minimal sépare deux bascules. Une configuration non sauvegardée n'est jamais remplacée automatiquement.",
  },
} satisfies Record<string, TooltipDoc>;
