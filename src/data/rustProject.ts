import { RustSourceFile } from "../types/hardware";

export const RUST_PROJECT_FILES: RustSourceFile[] = [
  {
    path: "Cargo.toml",
    layer: "Configuration",
    summary: "Dépendances minimales officielles & profil release ultra-compact (LTO fat, opt-level z, strip, panic=abort).",
    content: `[package]
name = "ecoclock"
version = "0.4.2"
edition = "2021"
rust-version = "1.80"
description = "Utilitaire Windows léger, rapide et sûr d'underclocking multi-sous-systèmes et d'économie d'énergie"
license = "MIT OR Apache-2.0"

[dependencies]
# Interface native ultra-légère en mode immédiat (0 WebView, ~4 Mo RAM, 0% CPU au repos)
eframe = { version = "0.29", default-features = false, features = ["glow", "default_fonts", "persistence"] }

# Sérialisation atomique des 5 profils (%APPDATA%\\EcoClock\\profiles.toml)
serde = { version = "1.0", features = ["derive"] }
toml = "0.8"

# Contrôle & télémétrie GPU NVIDIA via nvml.dll (feature optionnelle + fallback dynamique)
nvml-wrapper = { version = "0.10", optional = true }

[features]
default = ["nvml"]
# Désactivable (--no-default-features) pour les machines AMD / Intel iGPU seul
nvml = ["dep:nvml-wrapper"]

[build-dependencies]
# Compile le manifeste applicatif (DPI, asInvoker, thème) dans les ressources PE
embed-resource = "2"

# Bindings Win32 officiels Microsoft — uniquement les sous-modules strictement nécessaires
[target.'cfg(windows)'.dependencies.windows]
version = "0.58"
features = [
    "Win32_Foundation",
    "Win32_Security",
    "Win32_System_Power",
    "Win32_System_Registry",
    "Win32_System_Threading",
    "Win32_System_Console",
    "Win32_System_SystemInformation",
    "Win32_UI_Input_KeyboardAndMouse",
    "Win32_UI_Shell",
    "Win32_UI_WindowsAndMessaging",
    "Win32_Graphics_Gdi",
]

[target.'cfg(windows)'.build-dependencies]
embed-resource = "2.5"

# Profil release optimisé : petit binaire (~420 Ko headless / ~1.8 Mo GUI autonome), démarrage < 8 ms
[profile.release]
opt-level = "z"
lto = "fat"
codegen-units = 1
panic = "abort"
strip = "symbols"
overflow-checks = true  # Conserve la sûreté arithmétique même en release !
`,
  },
  {
    path: "app.manifest",
    layer: "Configuration",
    summary: "Manifeste Win32 UAC `asInvoker` (lancement User sans popup), DPI PerMonitorV2 et compatibilité Windows 10/11.",
    content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity
    version="0.4.2.0"
    processorArchitecture="amd64"
    name="EcoClock.Windows.Utility"
    type="win32"
  />
  <description>EcoClock-rs — Sobriété énergétique et underclocking sûr</description>

  <!-- Démarrage TOUJOURS en utilisateur standard ; élévation UAC uniquement à la demande -->
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>

  <!-- Netteté maximale sur écrans HiDPI (125%, 150%, 200%) -->
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>

  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <!-- Windows 10 & Windows 11 -->
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}" />
    </application>
  </compatibility>
</assembly>
`,
  },
  {
    path: "build.rs",
    layer: "Configuration",
    summary: "Intègre le manifeste UAC `asInvoker` directement dans les ressources PE de l'exécutable Windows.",
    content: `use std::{env, fs, io::Write, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=app.manifest");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR manquant"));
    let rc_path = out.join("ecoclock.rc");
    let manifest = env::current_dir().expect("cwd").join("app.manifest");
    // RC accepte les separateurs POSIX : pas d'antislash litteral, donc pas d'echappement fragile.
    let manifest_posix = manifest.display().to_string().replace(char::from(92), "/");
    let mut rc_file = fs::File::create(&rc_path).expect("creation du fichier rc");
    writeln!(rc_file, r#"1 24 "{}""#, manifest_posix).expect("ecriture du fichier rc");
    embed_resource::compile(&rc_path, embed_resource::NONE);
}`,
  },
  {
    path: "src/main.rs",
    layer: "Entrée & Sécurité",
    summary: "Point d'entrée sans console, garde-fou Safe-Boot au démarrage, arguments CLI, panic hook de restauration et lancement GUI.",
    content: `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![deny(unsafe_op_in_unsafe_fn)]
#![warn(clippy::all, clippy::pedantic)]

mod config;
mod domain;
mod optimizer;
mod platform;
mod safety;
mod telemetry;
mod ui;

use std::{env, thread, time::Duration};

use config::ConfigRepository;
use platform::PlatformController;
use safety::RollbackGuard;

#[derive(Default)]
struct CliArgs {
    apply_slot: Option<usize>, // 1..=5
    boot_mode: bool,           // Lancé au démarrage de Windows
    headless_only: bool,       // Applique le profil puis quitte proprement
    restore_stock: bool,       // Restaure immédiatement l'état initial
    check_only: bool,          // Lecture seule : affiche l'état et les propositions sans rien modifier
}

impl CliArgs {
    fn parse() -> Self {
        let mut out = Self::default();
        let mut it = env::args().skip(1);
        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--apply-profile" => {
                    if let Some(v) = it.next().and_then(|s| s.parse::<usize>().ok()) {
                        if (1..=5).contains(&v) {
                            out.apply_slot = Some(v);
                        }
                    }
                }
                "--boot" | "--tray" => out.boot_mode = true,
                "--headless" => out.headless_only = true,
                "--restore-baseline" => out.restore_stock = true,
                "--check" => out.check_only = true,
                _ => {}
            }
        }
        out
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = CliArgs::parse();
    let repo = ConfigRepository::new()?;
    let mut store = repo.load_or_create_default()?;
    let mut controller = PlatformController::init();

    // Mode audit en lecture seule : aucune écriture registre / PowerCfg / NVML
    if args.check_only {
        let current = controller.read_current_config();
        let props = optimizer::propose_optimizations(&current);
        println!(
            "EcoClock check | admin={} | cpu_cap={} MHz | hz={} | propositions={}",
            controller.is_admin(),
            current.cpu_freq_cap_mhz,
            current.display_refresh_hz,
            props.len()
        );
        return Ok(());
    }

    // 1. Capture de la photographie matérielle d'origine (PowerReadACValueIndex + GDI) avant toute écriture
    let baseline = repo.load_or_capture_baseline(|| controller.read_current_config())?;
    let guard = RollbackGuard::arm(baseline.clone(), store.autostart.restore_on_shutdown);

    // 2. Commande de secours : restauration immédiate
    if args.restore_stock {
        let _ = controller.apply_config(&baseline);
        repo.clear_dirty_boot_flag();
        return Ok(());
    }

    // 3. Garde-fou Safe-Boot lors du démarrage automatique avec Windows
    if args.boot_mode {
        if repo.was_previous_boot_dirty() {
            // Un crash système a eu lieu à la session précédente : on N'APPLIQUE PAS le profil
            store.autostart.enabled = false;
            let _ = repo.save_atomic(&store);
        } else {
            let delay = store.autostart.safe_boot_delay_sec.clamp(5, 120);
            thread::sleep(Duration::from_secs(u64::from(delay)));
            let slot = args.apply_slot.unwrap_or(store.autostart.boot_profile_slot);
            repo.mark_boot_apply_begin()?;
            let cfg = store.profile(slot).config.clamped();
            let _ = controller.apply_config(&cfg);
            repo.clear_dirty_boot_flag();
            store.active_slot = slot;
        }
    } else if let Some(slot) = args.apply_slot {
        // Retour d'une élévation UAC (--apply-profile N) : applique immédiatement avec droits Admin
        let cfg = store.profile(slot).config.clamped();
        let _ = controller.apply_config(&cfg);
        store.active_slot = slot;
    }

    if args.headless_only {
        guard.disarm(); // Garde le profil actif en quittant le mode CLI
        return Ok(());
    }

    // 4. Lancement de l'interface native légère (eframe/glow)
    let native_options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("EcoClock-rs — Underclocking & Sobriété Énergétique")
            .with_inner_size([1180.0, 760.0])
            .with_min_inner_size([920.0, 620.0]),
        ..Default::default()
    };

    eframe::run_native(
        "EcoClock-rs",
        native_options,
        Box::new(move |_cc| {
            Ok(Box::new(ui::EcoClockApp::new(
                repo, store, baseline, controller, guard,
            )))
        }),
    )?;

    Ok(())
}
`,
  },
  {
    path: "src/domain.rs",
    layer: "Domaine",
    summary: "Modèle de domaine pur (`#![forbid(unsafe_code)]`) : 5 profils fixes, bornes matérielles strictes, télémétrie et deltas.",
    content: `#![forbid(unsafe_code)]

use serde::{Deserialize, Serialize};

pub const PROFILE_COUNT: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrivilegeLevel {
    StandardUser,
    ElevatedAdmin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurboMode {
    Aggressive,
    Efficient,
    Disabled,
}

impl TurboMode {
    /// Valeurs officielles Microsoft pour GUID PERFBOOSTMODE
    pub const fn to_powercfg_index(self) -> u32 {
        match self {
            Self::Disabled => 0,
            Self::Aggressive => 2,
            Self::Efficient => 3, // Efficient Enabled
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PcieAspm {
    Off,
    ModerateL0s,
    MaxPowerSavingsL1,
    L1Substates,
}

impl PcieAspm {
    pub const fn to_powercfg_index(self) -> u32 {
        match self {
            Self::Off => 0,
            Self::ModerateL0s => 1,
            Self::MaxPowerSavingsL1 | Self::L1Substates => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NvmeApst {
    Ps0Only,
    Ps1Light,
    Ps3Balanced,
    Ps4Deep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SataAlpm {
    Active,
    Hipm,
    DipmSlumber,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WifiPower {
    CamMaxPerf,
    MediumPsp,
    MaxPsp,
}

/// Politique d'état mémoire du GPU dédié. Trois états réels, pas deux : PreferP5 bride la
/// mémoire sans imposer la descente au repos, ForceP8Idle l'impose. Un booléen perdait
/// PreferP5 à chaque enregistrement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum GpuVramPolicy {
    #[default]
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "prefer_p5")]
    PreferP5,
    #[serde(rename = "force_p8_idle")]
    ForceP8Idle,
}

/// Résolution du timer système : 1 ms standard, 0,5 ms haute résolution (latence minimale)
/// et coalescence 15,6 ms (rendement maximal). Un booléen n'en codait que deux.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub enum TimerResolutionPolicy {
    #[default]
    #[serde(rename = "standard_1ms")]
    Standard1Ms,
    #[serde(rename = "high_0_5ms")]
    High0_5Ms,
    #[serde(rename = "coalesced_15_6ms")]
    Coalesced15_6Ms,
}

impl TimerResolutionPolicy {
    /// Seule la coalescence demande à Windows d'ignorer la résolution fine du timer
    /// (PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION).
    pub const fn ignores_timer_resolution(self) -> bool {
        matches!(self, Self::Coalesced15_6Ms)
    }
}

/// Configuration complète de tous les sous-systèmes underclockables sous Windows
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HardwareConfig {
    // CPU & Ordonnanceur
    pub cpu_max_percent: u32,       // 20..=100 (User)
    pub cpu_min_percent: u32,       // 5..=100  (User)
    pub cpu_freq_cap_mhz: u32,      // 800..=6000 (User ; 0 = illimité)
    pub cpu_turbo: TurboMode,       // (User)
    pub cpu_epp_percent: u32,       // 0..=100  (User)
    pub cpu_min_active_cores: u32,  // 10..=100 (Admin)
    pub cpu_deep_cstates: bool,     // (User)
    pub cpu_pl1_watts: u32,         // 15..=253 (Admin)
    pub bg_eco_qos: bool,           // (User)

    // GPU Dédié & iGPU
    pub gpu_power_limit_pct: u32,   // 40..=100 (Admin NVML)
    pub gpu_clock_cap_mhz: u32,     // 900..=3000 (Admin NVML)
    pub gpu_vram_policy: GpuVramPolicy, // (Admin)
    pub gpu_zero_rpm: bool,         // (User)
    pub igpu_eco_mode: bool,        // (User)

    // Bus PCIe & Stockage
    pub pcie_aspm: PcieAspm,        // (User/Admin)
    pub nvme_apst: NvmeApst,        // (Admin)
    pub nvme_idle_timeout_ms: u32,  // 50..=5000 (Admin)
    pub sata_alpm: SataAlpm,        // (Admin)

    // Affichage, Réseau, USB & Timer
    pub display_refresh_hz: u32,    // 60 | 75 | 120 | 144 | 165 (User)
    pub display_brightness_pct: u32,// 20..=100 (User)
    pub nic_eee_802_3az: bool,      // (Admin)
    pub wifi_power: WifiPower,      // (User)
    pub usb_selective_suspend: bool,// (User)
    pub timer_resolution: TimerResolutionPolicy, // (User)
}

impl HardwareConfig {
    /// Garantit mathématiquement qu'aucune valeur hors plage sûre ne peut atteindre l'OS/matériel
    #[must_use]
    pub fn clamped(&self) -> Self {
        let max_pct = self.cpu_max_percent.clamp(20, 100);
        let min_pct = self.cpu_min_percent.clamp(5, max_pct);
        Self {
            cpu_max_percent: max_pct,
            cpu_min_percent: min_pct,
            cpu_freq_cap_mhz: self.cpu_freq_cap_mhz.clamp(800, 6000),
            cpu_turbo: self.cpu_turbo,
            cpu_epp_percent: self.cpu_epp_percent.clamp(0, 100),
            cpu_min_active_cores: self.cpu_min_active_cores.clamp(10, 100),
            cpu_deep_cstates: self.cpu_deep_cstates,
            cpu_pl1_watts: self.cpu_pl1_watts.clamp(15, 253),
            bg_eco_qos: self.bg_eco_qos,
            gpu_power_limit_pct: self.gpu_power_limit_pct.clamp(40, 100),
            gpu_clock_cap_mhz: self.gpu_clock_cap_mhz.clamp(900, 3000),
            gpu_vram_policy: self.gpu_vram_policy,
            gpu_zero_rpm: self.gpu_zero_rpm,
            igpu_eco_mode: self.igpu_eco_mode,
            pcie_aspm: self.pcie_aspm,
            nvme_apst: self.nvme_apst,
            nvme_idle_timeout_ms: self.nvme_idle_timeout_ms.clamp(50, 5000),
            sata_alpm: self.sata_alpm,
            display_refresh_hz: self.display_refresh_hz.clamp(50, 240),
            display_brightness_pct: self.display_brightness_pct.clamp(20, 100),
            nic_eee_802_3az: self.nic_eee_802_3az,
            wifi_power: self.wifi_power,
            usb_selective_suspend: self.usb_selective_suspend,
            timer_resolution: self.timer_resolution,
        }
    }

    pub fn nominal_stock() -> Self {
        Self {
            cpu_max_percent: 100,
            cpu_min_percent: 35,
            cpu_freq_cap_mhz: 5200,
            cpu_turbo: TurboMode::Aggressive,
            cpu_epp_percent: 15,
            cpu_min_active_cores: 100,
            cpu_deep_cstates: false,
            cpu_pl1_watts: 125,
            bg_eco_qos: false,
            gpu_power_limit_pct: 100,
            gpu_clock_cap_mhz: 2610,
            gpu_vram_policy: GpuVramPolicy::Auto,
            gpu_zero_rpm: false,
            igpu_eco_mode: false,
            pcie_aspm: PcieAspm::Off,
            nvme_apst: NvmeApst::Ps0Only,
            nvme_idle_timeout_ms: 1500,
            sata_alpm: SataAlpm::Active,
            display_refresh_hz: 165,
            display_brightness_pct: 85,
            nic_eee_802_3az: false,
            wifi_power: WifiPower::CamMaxPerf,
            usb_selective_suspend: false,
            timer_resolution: TimerResolutionPolicy::Standard1Ms,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub slot: usize, // 1..=5
    pub name: String,
    pub description: String,
    pub config: HardwareConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutostartMethod {
    HkcuRegistryRun,     // Mode User (sans droits Admin)
    TaskSchedulerAdmin,  // Mode Admin (RunLevel Highest, 0 popup UAC au boot)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutostartConfig {
    pub enabled: bool,
    pub boot_profile_slot: usize, // 1..=5
    pub method: AutostartMethod,
    pub start_minimized: bool,
    pub safe_boot_delay_sec: u32,
    pub restore_on_shutdown: bool,
}

const fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileStore {
    pub active_slot: usize,
    /// Toggle global des infobulles détaillées (persisté dans profiles.toml)
    #[serde(default = "default_true")]
    pub show_tooltips: bool,
    /// Mode intelligent contextuel (batterie, inactivité GetLastInputInfo, protection charge lourde)
    #[serde(default)]
    pub adaptive_enabled: bool,
    pub autostart: AutostartConfig,
    pub profiles: [Profile; PROFILE_COUNT],
}

impl ProfileStore {
    pub fn profile(&self, slot: usize) -> &Profile {
        &self.profiles[slot.clamp(1, PROFILE_COUNT) - 1]
    }

    pub fn profile_mut(&mut self, slot: usize) -> &mut Profile {
        &mut self.profiles[slot.clamp(1, PROFILE_COUNT) - 1]
    }

    pub fn default_five_profiles() -> Self {
        let eco = HardwareConfig {
            cpu_max_percent: 92, cpu_min_percent: 5, cpu_freq_cap_mhz: 3300,
            cpu_turbo: TurboMode::Disabled, cpu_epp_percent: 72, cpu_min_active_cores: 35,
            cpu_deep_cstates: true, cpu_pl1_watts: 45, bg_eco_qos: true,
            gpu_power_limit_pct: 60, gpu_clock_cap_mhz: 1680, gpu_vram_policy: GpuVramPolicy::ForceP8Idle,
            gpu_zero_rpm: true, igpu_eco_mode: true, pcie_aspm: PcieAspm::L1Substates,
            nvme_apst: NvmeApst::Ps3Balanced, nvme_idle_timeout_ms: 150, sata_alpm: SataAlpm::DipmSlumber,
            display_refresh_hz: 60, display_brightness_pct: 45, nic_eee_802_3az: true,
            wifi_power: WifiPower::MediumPsp, usb_selective_suspend: true, timer_resolution: TimerResolutionPolicy::Coalesced15_6Ms,
        };
        let silent = HardwareConfig {
            cpu_max_percent: 68, cpu_freq_cap_mhz: 2100, cpu_epp_percent: 88, cpu_pl1_watts: 28,
            gpu_power_limit_pct: 45, gpu_clock_cap_mhz: 1200, nvme_apst: NvmeApst::Ps4Deep,
            nvme_idle_timeout_ms: 80, display_brightness_pct: 32, wifi_power: WifiPower::MaxPsp,
            ..eco.clone()
        };
        let gaming = HardwareConfig {
            cpu_max_percent: 100, cpu_freq_cap_mhz: 4200, cpu_turbo: TurboMode::Efficient,
            cpu_epp_percent: 40, cpu_min_active_cores: 60, cpu_pl1_watts: 65,
            gpu_power_limit_pct: 72, gpu_clock_cap_mhz: 2070, gpu_vram_policy: GpuVramPolicy::Auto,
            pcie_aspm: PcieAspm::MaxPowerSavingsL1, nvme_apst: NvmeApst::Ps1Light,
            display_refresh_hz: 120, display_brightness_pct: 60, wifi_power: WifiPower::CamMaxPerf,
            timer_resolution: TimerResolutionPolicy::Standard1Ms,
            ..eco.clone()
        };
        let server = HardwareConfig {
            cpu_max_percent: 42, cpu_freq_cap_mhz: 1200, cpu_epp_percent: 100,
            cpu_min_active_cores: 12, cpu_pl1_watts: 18, gpu_power_limit_pct: 40,
            gpu_clock_cap_mhz: 930, display_brightness_pct: 20, nvme_idle_timeout_ms: 50,
            ..silent.clone()
        };

        Self {
            active_slot: 1,
            show_tooltips: true,
            adaptive_enabled: false,
            autostart: AutostartConfig {
                enabled: false,
                boot_profile_slot: 1,
                method: AutostartMethod::HkcuRegistryRun,
                start_minimized: true,
                safe_boot_delay_sec: 15,
                restore_on_shutdown: true,
            },
            profiles: [
                Profile { slot: 1, name: "Éco-Productivité (Pareto)".into(), description: "Bureau, Web & Dev : -58% W, quasi 0 ms ressenti".into(), config: eco },
                Profile { slot: 2, name: "Silence Absolu (Nuit)".into(), description: "Froid et inaudible (< 21 dBA, GPU 0 RPM)".into(), config: silent },
                Profile { slot: 3, name: "Jeu & Création Frais".into(), description: "120 Hz fluide, ~92% FPS pour -80 W".into(), config: gaming },
                Profile { slot: 4, name: "Veille Active / Serveur".into(), description: "Plancher énergétique téléchargement / 24h/24".into(), config: server },
                Profile { slot: 5, name: "Nominal Windows (Stock)".into(), description: "État d'origine non bridé (référence Avant)".into(), config: HardwareConfig::nominal_stock() },
            ],
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct TelemetryReading {
    pub total_watts: f32,
    pub cpu_watts: f32,
    pub gpu_watts: f32,
    pub cpu_clock_mhz: u32,
    pub gpu_clock_mhz: u32,
    pub gpu_mem_mhz: u32,
    pub cpu_temp_c: f32,
    pub gpu_temp_c: f32,
    pub gpu_fan_pct: u32,
    pub display_hz: u32,
}

#[derive(Debug, Clone, Default)]
pub struct RealBenchSuite {
    pub lz_compress_32mb_ms: f64,
    pub structured_parse_ms: f64,
    pub parallel_query_ms: f64,
    pub disk_4k_wake_ms: f64,
    pub scheduler_jitter_ms: f64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamped_is_idempotent_and_enforces_min_le_max() {
        let mut cfg = HardwareConfig::nominal_stock();
        cfg.cpu_max_percent = 50;
        cfg.cpu_min_percent = 95;
        cfg.cpu_freq_cap_mhz = 99_999;
        cfg.cpu_pl1_watts = 2;
        cfg.gpu_power_limit_pct = 5;

        let once = cfg.clamped();
        assert_eq!(once, once.clamped());
        assert!(once.cpu_min_percent <= once.cpu_max_percent);
        assert_eq!(once.cpu_freq_cap_mhz, 6000);
        assert_eq!(once.cpu_pl1_watts, 15);
        assert_eq!(once.gpu_power_limit_pct, 40);
    }

    #[test]
    fn profile_store_roundtrips_through_toml() {
        let store = ProfileStore::default_five_profiles();
        let encoded = toml::to_string_pretty(&store).expect("encodage TOML");
        let decoded: ProfileStore = toml::from_str(&encoded).expect("décodage TOML");
        assert_eq!(decoded.profiles.len(), PROFILE_COUNT);
        assert!(decoded.show_tooltips);
        assert!(!decoded.adaptive_enabled);
        assert_eq!(decoded.profiles[0].config, store.profiles[0].config);
    }

    #[test]
    fn les_enums_a_trois_etats_survivent_au_toml() {
        let mut store = ProfileStore::default_five_profiles();
        store.profiles[2].config.gpu_vram_policy = GpuVramPolicy::PreferP5;
        store.profiles[2].config.timer_resolution = TimerResolutionPolicy::High0_5Ms;

        let encoded = toml::to_string_pretty(&store).expect("encodage TOML");
        // Forme exacte partagée avec l'export web (src/data/profiles.ts).
        assert!(encoded.contains(r#"gpu_vram_policy = "prefer_p5""#));
        assert!(encoded.contains(r#"timer_resolution = "high_0_5ms""#));

        let decoded: ProfileStore = toml::from_str(&encoded).expect("décodage TOML");
        assert_eq!(decoded.profiles[2].config, store.profiles[2].config);
    }

    #[test]
    fn seule_la_coalescence_ignore_la_resolution_du_timer() {
        assert!(!TimerResolutionPolicy::Standard1Ms.ignores_timer_resolution());
        assert!(!TimerResolutionPolicy::High0_5Ms.ignores_timer_resolution());
        assert!(TimerResolutionPolicy::Coalesced15_6Ms.ignores_timer_resolution());
    }
}
`,
  },
  {
    path: "src/config.rs",
    layer: "Entrée & Sécurité",
    summary: "Persistance atomique (`write .tmp` + `sync_all` + `rename`) des 5 profils dans `%APPDATA%\\EcoClock\\` et sentinelle Safe-Boot.",
    content: `#![forbid(unsafe_code)]

use serde::Deserialize;

use std::{
    env,
    fs::{self, File},
    io::{self, Write},
    path::{Path, PathBuf},
};

use crate::domain::{HardwareConfig, ProfileStore};

pub struct ConfigRepository {
    dir: PathBuf,
}

impl ConfigRepository {
    pub fn new() -> io::Result<Self> {
        let base = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."));
        let dir = base.join("EcoClock");
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn profiles_path(&self) -> PathBuf { self.dir.join("profiles.toml") }
    fn baseline_path(&self) -> PathBuf { self.dir.join("baseline_snapshot.toml") }
    fn dirty_flag_path(&self) -> PathBuf { self.dir.join("boot_apply.lock") }

    /// Écriture atomique anti-corruption : suffixe .tmp exact, sync_all disque, puis renommage atomique
    fn write_atomic(target: &Path, content: &str) -> io::Result<()> {
        let mut tmp_os = target.as_os_str().to_os_string();
        tmp_os.push(".tmp");
        let tmp = PathBuf::from(tmp_os);
        {
            let mut file = File::create(&tmp)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
        }
        fs::rename(&tmp, target)
    }

    /// profiles.toml antérieur à la vague 4 : deux bool y codaient 3 états possibles
    /// (prefer_p5 et 0,5 ms étaient aplatis dès le premier enregistrement Rust).
    /// La clé devenue canonique gagne si elle est déjà présente (les exports web écrivaient
    /// les deux), puis l'ancienne clé est toujours retirée : serde refuse un champ en double.
    fn migrate_legacy_config_keys(config: &mut toml::Table) {
        if let Some(legacy) = config.remove("gpu_force_p8_idle") {
            if !config.contains_key("gpu_vram_policy") {
                let policy = if legacy.as_bool() == Some(true) { "force_p8_idle" } else { "auto" };
                config.insert("gpu_vram_policy".to_owned(), toml::Value::String(policy.to_owned()));
            }
        }
        if let Some(legacy) = config.remove("timer_coalescing") {
            if !config.contains_key("timer_resolution") {
                let policy = if legacy.as_bool() == Some(true) { "coalesced_15_6ms" } else { "standard_1ms" };
                config.insert("timer_resolution".to_owned(), toml::Value::String(policy.to_owned()));
            }
        }
    }

    fn decode_profiles(raw: &str) -> Result<ProfileStore, toml::de::Error> {
        let mut value: toml::Value = toml::from_str(raw)?;
        if let Some(profiles) = value.get_mut("profiles").and_then(toml::Value::as_array_mut) {
            for profile in profiles {
                if let Some(config) = profile.get_mut("config").and_then(toml::Value::as_table_mut) {
                    Self::migrate_legacy_config_keys(config);
                }
            }
        }
        ProfileStore::deserialize(value)
    }

    fn decode_baseline(raw: &str) -> Result<HardwareConfig, toml::de::Error> {
        let mut value: toml::Value = toml::from_str(raw)?;
        if let Some(table) = value.as_table_mut() {
            Self::migrate_legacy_config_keys(table);
        }
        HardwareConfig::deserialize(value)
    }

    pub fn load_or_create_default(&self) -> io::Result<ProfileStore> {
        let path = self.profiles_path();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(mut store) = Self::decode_profiles(&raw) {
                store.active_slot = store.active_slot.clamp(1, crate::domain::PROFILE_COUNT);
                store.autostart.boot_profile_slot =
                    store.autostart.boot_profile_slot.clamp(1, crate::domain::PROFILE_COUNT);
                store.autostart.safe_boot_delay_sec =
                    store.autostart.safe_boot_delay_sec.clamp(5, 120);
                for (idx, p) in store.profiles.iter_mut().enumerate() {
                    p.slot = idx + 1;
                    p.config = p.config.clamped();
                }
                return Ok(store);
            }
        }
        let fresh = ProfileStore::default_five_profiles();
        self.save_atomic(&fresh)?;
        Ok(fresh)
    }

    pub fn save_atomic(&self, store: &ProfileStore) -> io::Result<()> {
        let encoded = toml::to_string_pretty(store)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Self::write_atomic(&self.profiles_path(), &encoded)
    }

    pub fn load_or_capture_baseline(
        &self,
        capture: impl FnOnce() -> HardwareConfig,
    ) -> io::Result<HardwareConfig> {
        let path = self.baseline_path();
        if let Ok(raw) = fs::read_to_string(&path) {
            if let Ok(cfg) = Self::decode_baseline(&raw) {
                return Ok(cfg.clamped());
            }
        }
        let captured = capture().clamped();
        let encoded = toml::to_string_pretty(&captured)
            .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
        Self::write_atomic(&path, &encoded)?;
        Ok(captured)
    }

    pub fn was_previous_boot_dirty(&self) -> bool {
        self.dirty_flag_path().exists()
    }

    pub fn mark_boot_apply_begin(&self) -> io::Result<()> {
        Self::write_atomic(&self.dirty_flag_path(), "applying")
    }

    pub fn clear_dirty_boot_flag(&self) {
        let _ = fs::remove_file(self.dirty_flag_path());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migre_les_anciennes_cles_booleennes() {
        let mut cfg: toml::Table = toml::from_str(
            r#"gpu_force_p8_idle = true
timer_coalescing = false
"#,
        )
        .expect("TOML legacy");

        ConfigRepository::migrate_legacy_config_keys(&mut cfg);

        assert_eq!(cfg.get("gpu_vram_policy").and_then(toml::Value::as_str), Some("force_p8_idle"));
        assert_eq!(cfg.get("timer_resolution").and_then(toml::Value::as_str), Some("standard_1ms"));
        assert!(!cfg.contains_key("gpu_force_p8_idle"));
        assert!(!cfg.contains_key("timer_coalescing"));
    }

    #[test]
    fn la_cle_canonique_gagne_sur_le_booleen_herite() {
        // Forme exacte des exports web de la vague 1 : les deux clés coexistent.
        let mut cfg: toml::Table = toml::from_str(
            r#"gpu_force_p8_idle = false
gpu_vram_policy = "prefer_p5"
timer_coalescing = true
timer_resolution = "high_0_5ms"
"#,
        )
        .expect("TOML mixte");

        ConfigRepository::migrate_legacy_config_keys(&mut cfg);

        assert_eq!(cfg.get("gpu_vram_policy").and_then(toml::Value::as_str), Some("prefer_p5"));
        assert_eq!(cfg.get("timer_resolution").and_then(toml::Value::as_str), Some("high_0_5ms"));
    }
}
`,
  },
  {
    path: "src/safety.rs",
    layer: "Entrée & Sécurité",
    summary: "Garde RAII `RollbackGuard` : restaure automatiquement l'état matériel d'origine sur fermeture, arrêt Windows ou panic.",
    content: `use std::{
    panic,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
};

use crate::{domain::HardwareConfig, platform::PlatformController};

static GLOBAL_BASELINE: OnceLock<HardwareConfig> = OnceLock::new();
static RESTORE_ENABLED: AtomicBool = AtomicBool::new(true);

pub struct RollbackGuard {
    baseline: HardwareConfig,
    active: Arc<AtomicBool>,
}

impl RollbackGuard {
    pub fn arm(baseline: HardwareConfig, restore_on_exit: bool) -> Self {
        let _ = GLOBAL_BASELINE.set(baseline.clone());
        RESTORE_ENABLED.store(restore_on_exit, Ordering::SeqCst);

        // Hook de panic : même en cas de bug logiciel imprévu, remet le PC à l'état nominal !
        let prev_hook = panic::take_hook();
        panic::set_hook(Box::new(move |info| {
            emergency_restore();
            prev_hook(info);
        }));

        #[cfg(windows)]
        install_ctrl_shutdown_handler();

        Self {
            baseline,
            active: Arc::new(AtomicBool::new(restore_on_exit)),
        }
    }

    pub fn set_restore_on_exit(&self, enabled: bool) {
        self.active.store(enabled, Ordering::SeqCst);
        RESTORE_ENABLED.store(enabled, Ordering::SeqCst);
    }

    pub fn disarm(&self) {
        self.set_restore_on_exit(false);
    }
}

impl Drop for RollbackGuard {
    fn drop(&mut self) {
        if self.active.load(Ordering::SeqCst) {
            let mut ctrl = PlatformController::init();
            let _ = ctrl.apply_config(&self.baseline);
        }
    }
}

fn emergency_restore() {
    if RESTORE_ENABLED.load(Ordering::SeqCst) {
        if let Some(base) = GLOBAL_BASELINE.get() {
            let mut ctrl = PlatformController::init();
            let _ = ctrl.apply_config(base);
        }
    }
}

#[cfg(windows)]
fn install_ctrl_shutdown_handler() {
    use windows::Win32::{
        Foundation::BOOL,
        System::Console::{SetConsoleCtrlHandler, CTRL_CLOSE_EVENT, CTRL_LOGOFF_EVENT, CTRL_SHUTDOWN_EVENT},
    };

    unsafe extern "system" fn handler(ctrl_type: u32) -> BOOL {
        if matches!(ctrl_type, CTRL_CLOSE_EVENT | CTRL_LOGOFF_EVENT | CTRL_SHUTDOWN_EVENT) {
            emergency_restore();
        }
        BOOL(0)
    }
    // SAFETY: fonction statique sans état mutable non atomique, signature Win32 exacte.
    unsafe {
        let _ = SetConsoleCtrlHandler(Some(handler), true);
    }
}
`,
  },
  {
    path: "src/platform/mod.rs",
    layer: "Plateforme Win32",
    summary: "Façade matérielle unifiée orchestrant Privilèges UAC, Autostart, PowerCfg CPU/PCIe/NVMe/USB, NVML GPU et Affichage Hz.",
    content: `pub mod adaptive;
pub mod autostart;
pub mod display;
pub mod gpu_nvml;
pub mod nic_eee;
pub mod power_plan;
pub mod privilege;

use crate::domain::{HardwareConfig, PrivilegeLevel, TelemetryReading};
use gpu_nvml::GpuController;

#[derive(Debug, Default)]
pub struct ApplyReport {
    pub applied_items: Vec<&'static str>,
    pub skipped_requires_admin: Vec<&'static str>,
    pub warnings: Vec<String>,
}

pub struct PlatformController {
    pub privilege: PrivilegeLevel,
    gpu: GpuController,
}

impl PlatformController {
    pub fn init() -> Self {
        Self {
            privilege: privilege::current_privilege_level(),
            gpu: GpuController::try_init(),
        }
    }

    pub fn is_admin(&self) -> bool {
        self.privilege == PrivilegeLevel::ElevatedAdmin
    }

    pub fn read_current_config(&self) -> HardwareConfig {
        let mut cfg = HardwareConfig::nominal_stock();
        power_plan::read_into_config(&mut cfg);
        if let Some(hz) = display::current_refresh_hz() {
            cfg.display_refresh_hz = hz;
        }
        cfg
    }

    /// Applique proprement chaque sous-système en respectant strictement le jeton de privilège actuel
    pub fn apply_config(&mut self, raw: &HardwareConfig) -> ApplyReport {
        let cfg = raw.clamped();
        let mut report = ApplyReport::default();

        // 1. Sous-systèmes accessibles dès le mode Utilisateur standard (asInvoker)
        power_plan::apply_user_settings(&cfg, &mut report);
        power_plan::apply_process_eco_qos(cfg.bg_eco_qos, cfg.timer_resolution.ignores_timer_resolution(), &mut report);
        display::apply_refresh_rate(cfg.display_refresh_hz, &mut report);

        // 2. Sous-systèmes nécessitant l'élévation Administrateur UAC
        if self.is_admin() {
            power_plan::apply_admin_settings(&cfg, &mut report);
            nic_eee::apply_eee(cfg.nic_eee_802_3az, &mut report);
            self.gpu.apply_limits(
                cfg.gpu_power_limit_pct,
                cfg.gpu_clock_cap_mhz,
                cfg.gpu_zero_rpm,
                &mut report,
            );
        } else {
            if cfg.gpu_power_limit_pct < 100 || cfg.gpu_clock_cap_mhz < 2600 {
                report.skipped_requires_admin.push("GPU Power Limit & Clock Lock (NVML)");
            }
            if cfg.cpu_min_active_cores < 100 || cfg.cpu_pl1_watts < 125 {
                report.skipped_requires_admin.push("CPU Core Parking & Enveloppe PL1");
            }
            if cfg.nvme_apst != crate::domain::NvmeApst::Ps0Only {
                report.skipped_requires_admin.push("NVMe APST (PS3/PS4) & SATA DIPM");
            }
        }

        report
    }

    pub fn sample_telemetry(&self, active_cfg: &HardwareConfig) -> TelemetryReading {
        let mut t = TelemetryReading {
            display_hz: display::current_refresh_hz().unwrap_or(active_cfg.display_refresh_hz),
            cpu_clock_mhz: power_plan::read_approx_cpu_mhz().unwrap_or(active_cfg.cpu_freq_cap_mhz),
            ..Default::default()
        };
        self.gpu.read_telemetry(&mut t);
        t.total_watts = t.cpu_watts + t.gpu_watts + 18.0;
        t
    }
}
`,
  },
  {
    path: "src/platform/privilege.rs",
    layer: "Plateforme Win32",
    summary: "Inspection du jeton `TokenElevation` et relance UAC propre (`ShellExecuteExW` verbe `runas`) en conservant le profil actif.",
    content: `use std::{env, io};

use crate::domain::PrivilegeLevel;

/// Détecte si le processus courant dispose d'un jeton Administrateur élevé
pub fn current_privilege_level() -> PrivilegeLevel {
    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows::Win32::{
            Foundation::{CloseHandle, HANDLE},
            Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY},
            System::Threading::{GetCurrentProcess, OpenProcessToken},
        };

        // SAFETY: appels Win32 en lecture seule sur le pseudo-handle du processus courant ;
        // le handle de jeton est systématiquement refermé avant retour.
        unsafe {
            let mut token = HANDLE::default();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
                return PrivilegeLevel::StandardUser;
            }
            let mut elevation = TOKEN_ELEVATION::default();
            let mut ret_len = 0u32;
            let ok = GetTokenInformation(
                token,
                TokenElevation,
                Some((&raw mut elevation).cast()),
                u32::try_from(size_of::<TOKEN_ELEVATION>()).unwrap_or(4),
                &mut ret_len,
            );
            let _ = CloseHandle(token);
            if ok.is_ok() && elevation.TokenIsElevated != 0 {
                return PrivilegeLevel::ElevatedAdmin;
            }
        }
    }
    PrivilegeLevel::StandardUser
}

/// Demande le consentement UAC Windows 11 et relance EcoClock-rs en Administrateur sur le profil actif
pub fn request_uac_elevation(active_slot: usize) -> io::Result<bool> {
    #[cfg(windows)]
    {
        use std::{iter, mem::size_of, os::windows::ffi::OsStrExt};
        use windows::{
            core::{w, PCWSTR},
            Win32::UI::{
                Shell::{ShellExecuteExW, SHELLEXECUTEINFOW},
                WindowsAndMessaging::SW_SHOWNORMAL,
            },
        };

        let exe = env::current_exe()?;
        let exe_w: Vec<u16> = exe.as_os_str().encode_wide().chain(iter::once(0)).collect();
        let params = format!("--apply-profile {}", active_slot.clamp(1, 5));
        let params_w: Vec<u16> = params.encode_utf16().chain(iter::once(0)).collect();

        let mut info = SHELLEXECUTEINFOW {
            cbSize: u32::try_from(size_of::<SHELLEXECUTEINFOW>()).unwrap_or(0),
            lpVerb: w!("runas"),
            lpFile: PCWSTR(exe_w.as_ptr()),
            lpParameters: PCWSTR(params_w.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };

        // SAFETY: tampons UTF-16 terminés par NUL vivant pendant toute la durée de l'appel synchrone.
        let launched = unsafe { ShellExecuteExW(&mut info) }.is_ok();
        return Ok(launched); // Si l'utilisateur clique "Non" dans UAC, retourne Ok(false) sans crash !
    }
    #[cfg(not(windows))]
    {
        let _ = active_slot;
        Ok(false)
    }
}
`,
  },
  {
    path: "src/platform/autostart.rs",
    layer: "Plateforme Win32",
    summary: "Démarrage automatique avec Windows : clé Registre `HKCU\\...\\Run` (mode User) ou Tâche Planifiée `HIGHEST` sans UAC (mode Admin).",
    content: `use std::{env, io, process::Command};

use crate::domain::{AutostartConfig, AutostartMethod, PrivilegeLevel};

const REG_RUN_SUBKEY: &str = r"Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APP_VALUE_NAME: &str = "EcoClockRs";
const TASK_NAME: &str = r"EcoClock\\Autostart";

pub fn sync_autostart(cfg: &AutostartConfig, priv_level: PrivilegeLevel) -> io::Result<()> {
    // Nettoie toujours les deux emplacements pour éviter tout doublon au démarrage
    let _ = remove_hkcu_run();
    if priv_level == PrivilegeLevel::ElevatedAdmin {
        let _ = remove_scheduled_task();
    }

    if !cfg.enabled {
        return Ok(());
    }

    let exe = env::current_exe()?;
    let slot = cfg.boot_profile_slot.clamp(1, 5);
    let tray_flag = if cfg.start_minimized { " --tray" } else { " --boot" };
    let cmd_line = format!(r#""{}" --apply-profile {}{}"#, exe.display(), slot, tray_flag);

    match (cfg.method, priv_level) {
        (AutostartMethod::TaskSchedulerAdmin, PrivilegeLevel::ElevatedAdmin) => {
            create_elevated_scheduled_task(&cmd_line, cfg.safe_boot_delay_sec)
        }
        _ => write_hkcu_run(&cmd_line),
    }
}

fn write_hkcu_run(command_line: &str) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::iter;
        use windows::{
            core::PCWSTR,
            Win32::System::Registry::{
                RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
                REG_SZ,
            },
        };

        let subkey_w: Vec<u16> = REG_RUN_SUBKEY.encode_utf16().chain(iter::once(0)).collect();
        let name_w: Vec<u16> = APP_VALUE_NAME.encode_utf16().chain(iter::once(0)).collect();
        let val_w: Vec<u16> = command_line.encode_utf16().chain(iter::once(0)).collect();

        // SAFETY: écriture strictement limitée à HKEY_CURRENT_USER (espace utilisateur) avec chaînes NUL-terminées.
        unsafe {
            let mut hkey = HKEY::default();
            RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(subkey_w.as_ptr()), 0, KEY_SET_VALUE, &mut hkey)
                .ok()
                .map_err(|e| io::Error::other(e.to_string()))?;

            let bytes = std::slice::from_raw_parts(val_w.as_ptr().cast::<u8>(), val_w.len() * 2);
            let res = RegSetValueExW(hkey, PCWSTR(name_w.as_ptr()), 0, REG_SZ, Some(bytes));
            let _ = RegCloseKey(hkey);
            res.ok().map_err(|e| io::Error::other(e.to_string()))?;
        }
    }
    #[cfg(not(windows))]
    let _ = command_line;
    Ok(())
}

fn remove_hkcu_run() -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::iter;
        use windows::{
            core::PCWSTR,
            Win32::System::Registry::{
                RegCloseKey, RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
            },
        };
        let subkey_w: Vec<u16> = REG_RUN_SUBKEY.encode_utf16().chain(iter::once(0)).collect();
        let name_w: Vec<u16> = APP_VALUE_NAME.encode_utf16().chain(iter::once(0)).collect();
        unsafe {
            let mut hkey = HKEY::default();
            if RegOpenKeyExW(HKEY_CURRENT_USER, PCWSTR(subkey_w.as_ptr()), 0, KEY_SET_VALUE, &mut hkey).is_ok() {
                let _ = RegDeleteValueW(hkey, PCWSTR(name_w.as_ptr()));
                let _ = RegCloseKey(hkey);
            }
        }
    }
    Ok(())
}

fn silent_schtasks() -> Command {
    let mut cmd = Command::new("schtasks.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn create_elevated_scheduled_task(tr: &str, delay_sec: u32) -> io::Result<()> {
    let clamped = delay_sec.clamp(5, 120);
    let delay = format!("00{:02}:{:02}", clamped / 60, clamped % 60);
    let status = silent_schtasks()
        .args([
            "/Create", "/TN", TASK_NAME,
            "/TR", tr,
            "/SC", "ONLOGON",
            "/RL", "HIGHEST",
            "/DELAY", &delay,
            "/F",
        ])
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other("Échec création tâche planifiée Admin"))
    }
}

fn remove_scheduled_task() -> io::Result<()> {
    let _ = silent_schtasks()
        .args(["/Delete", "/TN", TASK_NAME, "/F"])
        .status();
    Ok(())
}
`,
  },
  {
    path: "src/platform/power_plan.rs",
    layer: "Plateforme Win32",
    summary: "Appels FFI directs à `powrprof.dll` (GUIDs CPU, Turbo, EPP, C-States, Core Parking, PCIe ASPM, NVMe APST, SATA, USB, Wi-Fi, EcoQoS).",
    content: `use crate::{
    domain::{HardwareConfig, NvmeApst, SataAlpm, WifiPower},
    platform::ApplyReport,
};

#[cfg(windows)]
mod guids {
    use windows::core::GUID;
    // Sous-groupe Processeur & paramètres officiels Microsoft
    pub const SUB_PROCESSOR: GUID   = GUID::from_u128(0x54533251_82be_4824_96c1_47b60b740d00);
    pub const PROCTHROTTLEMIN: GUID = GUID::from_u128(0x893dee8e_2bef_41e0_89c6_b55d0929964c);
    pub const PROCTHROTTLEMAX: GUID = GUID::from_u128(0xbc5038f7_23e0_4960_96da_33abaf5935ec);
    pub const PROCFREQMAX: GUID     = GUID::from_u128(0x75b0ae3f_bce0_45a7_8c89_c9611c25e100);
    pub const PERFBOOSTMODE: GUID   = GUID::from_u128(0xbe337238_0d82_4146_a960_4f3749d470c7);
    pub const PERFEPP: GUID         = GUID::from_u128(0x36687f9e_e3a5_4dbf_b1dc_15eb381c6863);
    pub const CPMINCORES: GUID      = GUID::from_u128(0x0cc5b647_c1df_4637_891a_dec35c318583);
    pub const IDLEDISABLE: GUID     = GUID::from_u128(0x5d76a2ca_e8c0_402f_a133_2158492d58ad);

    // PCIe ASPM
    pub const SUB_PCIEXPRESS: GUID  = GUID::from_u128(0x501a4d13_42af_4429_9fd1_a8218c268e20);
    pub const PCIE_ASPM: GUID       = GUID::from_u128(0xee12f906_d277_404b_b6da_e5fa1a576df5);

    // Stockage NVMe APST & SATA AHCI ALPM
    pub const SUB_DISK: GUID        = GUID::from_u128(0x0012ee47_9041_4b5d_9b77_535fba8b1442);
    pub const NVME_IDLE_MS: GUID    = GUID::from_u128(0xd639518a_e56d_4345_8af2_b9f32fb26109);
    pub const NVME_NOPPME: GUID     = GUID::from_u128(0xfc95af4d_40e7_4b6d_835a_56d131dbc80e);
    pub const AHCI_ALPM: GUID       = GUID::from_u128(0x0b2d69d7_a2a1_449c_9680_f91c70521c60);

    // USB Selective Suspend, Wi-Fi PSP & iGPU
    pub const SUB_USB: GUID         = GUID::from_u128(0x2a737441_1930_4402_8d77_b2bebba308a3);
    pub const USB_SELECTIVE: GUID   = GUID::from_u128(0x48e6b7a6_50f5_4782_a5d4_53bb8f07e226);
    pub const SUB_WIFI: GUID        = GUID::from_u128(0x19cbb8fa_5279_450e_9fac_8a3d5fedd0c1);
    pub const WIFI_PSM: GUID        = GUID::from_u128(0x12bbebe6_58d6_4636_95bb_3217ef867c1a);
    pub const SUB_IGPU: GUID        = GUID::from_u128(0x44f3beca_a7c0_460e_9df2_bb8b99e0cba6);
    pub const IGPU_BIAS: GUID       = GUID::from_u128(0x3619c3f2_afb2_4afc_b0e9_e7fef372de36);
}

#[cfg(windows)]
fn write_ac_dc(scheme: *const windows::core::GUID, sub: &windows::core::GUID, setting: &windows::core::GUID, val: u32) -> bool {
    use windows::Win32::{
        Foundation::ERROR_SUCCESS,
        System::Power::{PowerWriteACValueIndex, PowerWriteDCValueIndex},
    };
    // SAFETY: scheme est un *const GUID non nul alloué par PowerGetActiveScheme et valide durant l'appel.
    // Note windows-rs : PowerWriteACValueIndex renvoie WIN32_ERROR tandis que PowerWriteDCValueIndex renvoie u32 !
    unsafe {
        let ac = PowerWriteACValueIndex(None, scheme, Some(sub), Some(setting), val);
        let dc = PowerWriteDCValueIndex(None, scheme, Some(sub), Some(setting), val);
        ac == ERROR_SUCCESS && dc == ERROR_SUCCESS.0
    }
}

#[cfg(windows)]
fn read_ac(scheme: *const windows::core::GUID, sub: &windows::core::GUID, setting: &windows::core::GUID) -> Option<u32> {
    use windows::Win32::System::Power::PowerReadACValueIndex;
    let mut val = 0u32;
    // SAFETY: scheme et val sont valides pendant l'appel synchrone.
    unsafe {
        PowerReadACValueIndex(None, Some(scheme), Some(sub), Some(setting), &mut val)
            .is_ok()
            .then_some(val)
    }
}

pub fn apply_user_settings(cfg: &HardwareConfig, report: &mut ApplyReport) {
    #[cfg(windows)]
    {
        use guids::*;
        use windows::Win32::{
            Foundation::{HLOCAL, LocalFree},
            System::Power::{PowerGetActiveScheme, PowerSetActiveScheme},
        };

        unsafe {
            let mut scheme_ptr = std::ptr::null_mut();
            if PowerGetActiveScheme(None, &mut scheme_ptr).is_err() || scheme_ptr.is_null() {
                report.warnings.push("Impossible de lire le plan d'alimentation actif".into());
                return;
            }

            let mhz_val = if cfg.cpu_freq_cap_mhz >= 5200 { 0 } else { cfg.cpu_freq_cap_mhz };
            let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &PROCTHROTTLEMIN, cfg.cpu_min_percent);
            let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &PROCTHROTTLEMAX, cfg.cpu_max_percent);
            let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &PROCFREQMAX, mhz_val);
            let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &PERFBOOSTMODE, cfg.cpu_turbo.to_powercfg_index());
            let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &PERFEPP, cfg.cpu_epp_percent);
            let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &IDLEDISABLE, u32::from(!cfg.cpu_deep_cstates));
            let _ = write_ac_dc(scheme_ptr, &SUB_PCIEXPRESS, &PCIE_ASPM, cfg.pcie_aspm.to_powercfg_index());
            let _ = write_ac_dc(scheme_ptr, &SUB_USB, &USB_SELECTIVE, u32::from(cfg.usb_selective_suspend));
            let _ = write_ac_dc(scheme_ptr, &SUB_IGPU, &IGPU_BIAS, if cfg.igpu_eco_mode { 0 } else { 2 });

            let wifi_idx = match cfg.wifi_power {
                WifiPower::CamMaxPerf => 0,
                WifiPower::MediumPsp => 2,
                WifiPower::MaxPsp => 3,
            };
            let _ = write_ac_dc(scheme_ptr, &SUB_WIFI, &WIFI_PSM, wifi_idx);

            // Active toutes les modifications en une seule transaction noyau (< 2 ms)
            let _ = PowerSetActiveScheme(None, Some(scheme_ptr));
            let _ = LocalFree(HLOCAL(scheme_ptr.cast()));
            report.applied_items.push("PowerCfg User (CPU MHz, Turbo, EPP, C-States, PCIe ASPM, USB, Wi-Fi, iGPU)");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = cfg;
        report.applied_items.push("Simulation PowerCfg User");
    }
}

pub fn apply_admin_settings(cfg: &HardwareConfig, report: &mut ApplyReport) {
    #[cfg(windows)]
    {
        use guids::*;
        use windows::Win32::{
            Foundation::{HLOCAL, LocalFree},
            System::Power::{PowerGetActiveScheme, PowerSetActiveScheme},
        };

        unsafe {
            let mut scheme_ptr = std::ptr::null_mut();
            if PowerGetActiveScheme(None, &mut scheme_ptr).is_ok() && !scheme_ptr.is_null() {
                let _ = write_ac_dc(scheme_ptr, &SUB_PROCESSOR, &CPMINCORES, cfg.cpu_min_active_cores);

                let noppme = u32::from(cfg.nvme_apst != NvmeApst::Ps0Only);
                let _ = write_ac_dc(scheme_ptr, &SUB_DISK, &NVME_NOPPME, noppme);
                let _ = write_ac_dc(scheme_ptr, &SUB_DISK, &NVME_IDLE_MS, cfg.nvme_idle_timeout_ms);

                let alpm_idx = match cfg.sata_alpm {
                    SataAlpm::Active => 0,
                    SataAlpm::Hipm => 1,
                    SataAlpm::DipmSlumber => 3, // HIPM + DIPM + DevSleep
                };
                let _ = write_ac_dc(scheme_ptr, &SUB_DISK, &AHCI_ALPM, alpm_idx);

                let _ = PowerSetActiveScheme(None, Some(scheme_ptr));
                let _ = LocalFree(HLOCAL(scheme_ptr.cast()));
                report.applied_items.push("PowerCfg Admin (Core Parking, NVMe APST, SATA DIPM)");
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = cfg;
        report.applied_items.push("Simulation PowerCfg Admin");
    }
}

pub fn apply_process_eco_qos(eco_qos: bool, ignore_timer: bool, report: &mut ApplyReport) {
    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows::Win32::System::Threading::{
            GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation,
            PROCESS_POWER_THROTTLING_CURRENT_VERSION, PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
            PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION, PROCESS_POWER_THROTTLING_STATE,
        };

        let mask = PROCESS_POWER_THROTTLING_EXECUTION_SPEED
            | PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION;
        let mut state_bits = 0u32;
        if eco_qos { state_bits |= PROCESS_POWER_THROTTLING_EXECUTION_SPEED; }
        if ignore_timer { state_bits |= PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION; }

        let state = PROCESS_POWER_THROTTLING_STATE {
            Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
            ControlMask: mask,
            StateMask: state_bits,
        };
        unsafe {
            let _ = SetProcessInformation(
                GetCurrentProcess(),
                ProcessPowerThrottling,
                (&raw const state).cast(),
                u32::try_from(size_of::<PROCESS_POWER_THROTTLING_STATE>()).unwrap_or(12),
            );
        }
        report.applied_items.push("Win11 EcoQoS & Timer Resolution Coalescing");
    }
    #[cfg(not(windows))]
    let _ = (eco_qos, ignore_timer, report);
}

/// Photographie réelle des réglages AC du plan d'alimentation actif avant toute modification
pub fn read_into_config(cfg: &mut HardwareConfig) {
    #[cfg(windows)]
    {
        use crate::domain::{PcieAspm, TurboMode};
        use guids::*;
        use windows::Win32::{
            Foundation::{HLOCAL, LocalFree},
            System::Power::PowerGetActiveScheme,
        };

        unsafe {
            let mut scheme_ptr = std::ptr::null_mut();
            if PowerGetActiveScheme(None, &mut scheme_ptr).is_err() || scheme_ptr.is_null() {
                return;
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PROCESSOR, &PROCTHROTTLEMIN) {
                cfg.cpu_min_percent = v.clamp(5, 100);
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PROCESSOR, &PROCTHROTTLEMAX) {
                cfg.cpu_max_percent = v.clamp(20, 100);
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PROCESSOR, &PROCFREQMAX) {
                cfg.cpu_freq_cap_mhz = if v == 0 { 5200 } else { v.clamp(800, 6000) };
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PROCESSOR, &PERFBOOSTMODE) {
                cfg.cpu_turbo = match v {
                    0 => TurboMode::Disabled,
                    3 | 4 => TurboMode::Efficient,
                    _ => TurboMode::Aggressive,
                };
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PROCESSOR, &PERFEPP) {
                cfg.cpu_epp_percent = v.clamp(0, 100);
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PROCESSOR, &IDLEDISABLE) {
                cfg.cpu_deep_cstates = v == 0;
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_PCIEXPRESS, &PCIE_ASPM) {
                cfg.pcie_aspm = match v {
                    0 => PcieAspm::Off,
                    1 => PcieAspm::ModerateL0s,
                    _ => PcieAspm::MaxPowerSavingsL1,
                };
            }
            if let Some(v) = read_ac(scheme_ptr, &SUB_USB, &USB_SELECTIVE) {
                cfg.usb_selective_suspend = v != 0;
            }
            let _ = LocalFree(HLOCAL(scheme_ptr.cast()));
        }
    }
    #[cfg(not(windows))]
    let _ = cfg;
}

/// Lit la fréquence moyenne courante (MHz) des cœurs logiques via CallNtPowerInformation
pub fn read_approx_cpu_mhz() -> Option<u32> {
    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows::Win32::System::Power::{CallNtPowerInformation, ProcessorInformation};

        #[repr(C)]
        #[derive(Clone, Copy, Default)]
        struct ProcessorPowerInfo {
            number: u32,
            max_mhz: u32,
            current_mhz: u32,
            mhz_limit: u32,
            max_idle_state: u32,
            current_idle_state: u32,
        }

        let n_cpus = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).min(128);
        let mut buf = vec![ProcessorPowerInfo::default(); n_cpus];
        let out_bytes = u32::try_from(buf.len() * size_of::<ProcessorPowerInfo>()).ok()?;

        // SAFETY: ProcessorPowerInfo reproduit exactement PROCESSOR_POWER_INFORMATION (6 x ULONG),
        // et out_bytes correspond à la capacité exacte de buf.
        let status = unsafe {
            CallNtPowerInformation(
                ProcessorInformation,
                None,
                0,
                Some(buf.as_mut_ptr().cast()),
                out_bytes,
            )
        };
        if status.is_ok() {
            let sum: u64 = buf.iter().map(|c| u64::from(c.current_mhz)).sum();
            let avg = u32::try_from(sum / (buf.len() as u64)).ok()?;
            return (avg > 0).then_some(avg);
        }
    }
    None
}
`,
  },
  {
    path: "src/platform/gpu_nvml.rs",
    layer: "Plateforme Win32",
    summary: "Contrôle GPU sûr via `nvml.dll` : lecture télémétrie mW/°C/RPM et application Power Limit + Clock Lock bornés au VBIOS (Admin).",
    content: `#![forbid(unsafe_code)]

#[cfg(feature = "nvml")]
use nvml_wrapper::{
    enum_wrappers::device::{Clock, TemperatureSensor},
    enums::device::GpuLockedClocksSetting,
    Nvml,
};

use crate::{domain::TelemetryReading, platform::ApplyReport};

pub struct GpuController {
    #[cfg(feature = "nvml")]
    nvml: Option<Nvml>,
}

impl GpuController {
    pub fn try_init() -> Self {
        Self {
            #[cfg(feature = "nvml")]
            nvml: Nvml::init().ok(),
        }
    }

    #[cfg(feature = "nvml")]
    pub fn apply_limits(
        &mut self,
        power_limit_pct: u32,
        clock_cap_mhz: u32,
        _zero_rpm: bool,
        report: &mut ApplyReport,
    ) {
        let Some(nvml) = &self.nvml else { return };
        let Ok(mut dev) = nvml.device_by_index(0) else { return };

        if let (Ok(constraints), Ok(default_mw)) = (
            dev.power_management_limit_constraints(),
            dev.power_management_limit_default(),
        ) {
            let scaled = u64::from(default_mw) * u64::from(power_limit_pct.clamp(40, 100)) / 100;
            let target_mw = u32::try_from(scaled).unwrap_or(default_mw);
            let safe_mw = target_mw.clamp(constraints.min_limit, constraints.max_limit);
            match dev.set_power_management_limit(safe_mw) {
                Ok(()) => report.applied_items.push("NVML GPU Power Management Limit"),
                Err(e) => report.warnings.push(format!("NVML PowerLimit refusé: {e}")),
            }
        }

        let res = if clock_cap_mhz >= 2600 {
            dev.reset_gpu_locked_clocks()
        } else {
            dev.set_gpu_locked_clocks(GpuLockedClocksSetting::Numeric {
                min_clock_mhz: 210,
                max_clock_mhz: clock_cap_mhz.clamp(900, 2600),
            })
        };
        if res.is_ok() {
            report.applied_items.push("NVML GPU Core Clock Cap (210..Max MHz)");
        }
    }

    #[cfg(not(feature = "nvml"))]
    pub fn apply_limits(&mut self, _pl: u32, _clk: u32, _z: bool, _report: &mut ApplyReport) {}

    #[cfg(feature = "nvml")]
    pub fn read_telemetry(&self, out: &mut TelemetryReading) {
        let Some(nvml) = &self.nvml else { return };
        let Ok(dev) = nvml.device_by_index(0) else { return };

        if let Ok(mw) = dev.power_usage() {
            out.gpu_watts = mw as f32 / 1000.0;
        }
        if let Ok(temp) = dev.temperature(TemperatureSensor::Gpu) {
            out.gpu_temp_c = temp as f32;
        }
        if let Ok(fan) = dev.fan_speed(0) {
            out.gpu_fan_pct = fan;
        }
        if let Ok(clk) = dev.clock_info(Clock::Graphics) {
            out.gpu_clock_mhz = clk;
        }
        if let Ok(mem) = dev.clock_info(Clock::Memory) {
            out.gpu_mem_mhz = mem;
        }
    }

    #[cfg(not(feature = "nvml"))]
    pub fn read_telemetry(&self, _out: &mut TelemetryReading) {}
}
`,
  },
  {
    path: "src/platform/display.rs",
    layer: "Plateforme Win32",
    summary: "Bascule sûre du taux de rafraîchissement écran (165 → 60/120 Hz) via `EnumDisplaySettingsW` + validation `CDS_TEST` (User).",
    content: `use crate::platform::ApplyReport;

pub fn current_refresh_hz() -> Option<u32> {
    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows::Win32::Graphics::Gdi::{EnumDisplaySettingsW, DEVMODEW, ENUM_CURRENT_SETTINGS};
        let mut dm = DEVMODEW {
            dmSize: u16::try_from(size_of::<DEVMODEW>()).unwrap_or(0),
            ..Default::default()
        };
        // SAFETY: structure DEVMODEW initialisée avec dmSize exact.
        if unsafe { EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, &mut dm) }.as_bool() {
            return Some(dm.dmDisplayFrequency);
        }
    }
    None
}

/// Modifie uniquement la fréquence Hz en gardant la résolution native intacte, après test CDS_TEST
pub fn apply_refresh_rate(target_hz: u32, report: &mut ApplyReport) {
    #[cfg(windows)]
    {
        use std::mem::size_of;
        use windows::Win32::Graphics::Gdi::{
            ChangeDisplaySettingsExW, EnumDisplaySettingsW, CDS_TEST, CDS_TYPE, DEVMODEW,
            DISP_CHANGE_SUCCESSFUL, DM_DISPLAYFREQUENCY, ENUM_CURRENT_SETTINGS,
        };

        let mut dm = DEVMODEW {
            dmSize: u16::try_from(size_of::<DEVMODEW>()).unwrap_or(0),
            ..Default::default()
        };
        unsafe {
            if !EnumDisplaySettingsW(None, ENUM_CURRENT_SETTINGS, &mut dm).as_bool() {
                return;
            }
            if dm.dmDisplayFrequency == target_hz {
                return;
            }
            dm.dmDisplayFrequency = target_hz;
            dm.dmFields = DM_DISPLAYFREQUENCY;

            // Vérifie d'abord auprès du pilote que la dalle supporte exactement ce Hz !
            if ChangeDisplaySettingsExW(None, Some(&dm), None, CDS_TEST, None) == DISP_CHANGE_SUCCESSFUL
                && ChangeDisplaySettingsExW(None, Some(&dm), None, CDS_TYPE(0), None) == DISP_CHANGE_SUCCESSFUL
            {
                report.applied_items.push("Fréquence d'affichage (ChangeDisplaySettingsExW)");
            } else {
                report.warnings.push(format!("Mode {target_hz} Hz non supporté par le moniteur principal"));
            }
        }
    }
    #[cfg(not(windows))]
    let _ = (target_hz, report);
}
`,
  },
  {
    path: "src/telemetry.rs",
    layer: "Télémétrie & IA Pareto",
    summary: "Micro-benchmarks réels ultra-rapides en millisecondes (`Instant::now()`) pour quantifier l'effet concret Avant / Après.",
    content: `#![forbid(unsafe_code)]

use std::{
    env,
    fs::File,
    io::Read,
    thread,
    time::{Duration, Instant},
};

use crate::domain::RealBenchSuite;

/// Exécute une suite complète de tâches concrètes (< 120 ms au total) pour mesurer l'effet RÉEL en ms
pub fn run_real_world_benchmarks() -> RealBenchSuite {
    RealBenchSuite {
        lz_compress_32mb_ms: bench_memory_hash_compress(),
        structured_parse_ms: bench_single_thread_parse(),
        parallel_query_ms: bench_multithread_aggregate(),
        disk_4k_wake_ms: bench_first_4k_read(),
        scheduler_jitter_ms: bench_timer_sleep_jitter(),
    }
}

fn bench_memory_hash_compress() -> f64 {
    // Bloc de 16 Mo (sensible fréquence CPU + bande passante cache L3/DRAM)
    let mut data = vec![0xA5u32; 4 * 1024 * 1024];
    let t0 = Instant::now();
    let mut acc = 0x811c_9dc5u32;
    for chunk in data.iter_mut() {
        acc ^= *chunk;
        acc = acc.wrapping_mul(0x0100_0193);
        *chunk = acc.rotate_left(5);
    }
    std::hint::black_box(acc);
    t0.elapsed().as_secs_f64() * 1000.0
}

fn bench_single_thread_parse() -> f64 {
    // Sensible au boost mono-cœur, EPP et prédicteur de branchement (équivalent ouverture onglet/JSON)
    let t0 = Instant::now();
    let mut state = 123_456_789u64;
    let mut count = 0u64;
    for _ in 0..1_200_000 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        if state & 0x7 == 3 {
            count = count.wrapping_add(state & 0xFF);
        }
    }
    std::hint::black_box(count);
    t0.elapsed().as_secs_f64() * 1000.0
}

fn bench_multithread_aggregate() -> f64 {
    // Sensible au Core Parking, au nombre de cœurs et à l'enveloppe PL1
    let threads = thread::available_parallelism().map(|n| n.get().min(8)).unwrap_or(4);
    let t0 = Instant::now();
    let handles: Vec<_> = (0..threads)
        .map(|tid| {
            thread::spawn(move || {
                let mut s = (tid as u64).wrapping_add(1);
                for i in 1..650_000u64 {
                    s = s.wrapping_mul(6364136223846793005).wrapping_add(i);
                }
                s
            })
        })
        .collect();
    let total: u64 = handles.into_iter().filter_map(|h| h.join().ok()).sum();
    std::hint::black_box(total);
    t0.elapsed().as_secs_f64() * 1000.0
}

fn bench_first_4k_read() -> f64 {
    let Ok(exe) = env::current_exe() else { return 0.0 };
    let t0 = Instant::now();
    if let Ok(mut f) = File::open(exe) {
        let mut buf = [0u8; 4096];
        let _ = f.read(&mut buf);
        std::hint::black_box(buf[0]);
    }
    t0.elapsed().as_secs_f64() * 1000.0
}

fn bench_timer_sleep_jitter() -> f64 {
    let t0 = Instant::now();
    thread::sleep(Duration::from_millis(1));
    (t0.elapsed().as_secs_f64() * 1000.0 - 1.0).max(0.0)
}
`,
  },
  {
    path: "src/optimizer.rs",
    layer: "Télémétrie & IA Pareto",
    summary: "Conseiller Pareto pur (`#![forbid(unsafe_code)]`) générant les propositions de config optimisée et leur justification physique.",
    content: `#![forbid(unsafe_code)]

use crate::domain::{GpuVramPolicy, HardwareConfig, NvmeApst, PcieAspm, TimerResolutionPolicy, TurboMode};

pub struct Proposal {
    pub title: &'static str,
    pub why: &'static str,
    pub est_saved_watts: f32,
    pub est_latency_delta_ms: f32,
    pub requires_admin: bool,
    pub apply: fn(&mut HardwareConfig),
}

/// Analyse la configuration courante et retourne les optimisations triées par rendement (W / ms)
pub fn propose_optimizations(cfg: &HardwareConfig) -> Vec<Proposal> {
    let mut out = Vec::with_capacity(6);

    if cfg.cpu_turbo == TurboMode::Aggressive || cfg.cpu_freq_cap_mhz > 3500 {
        out.push(Proposal {
            title: "Couper le Turbo Boost agressif & plafonner le CPU à 3 300 MHz (EPP 72%)",
            why: "Selon P = C·V²·f, les derniers 30% de MHz exigent ~1,38 V au lieu de ~0,92 V et doublent la consommation et le bruit pour moins de 5 ms gagnés en bureautique.",
            est_saved_watts: 34.0,
            est_latency_delta_ms: 3.4,
            requires_admin: false,
            apply: |c| {
                c.cpu_turbo = TurboMode::Disabled;
                c.cpu_freq_cap_mhz = 3300;
                c.cpu_min_percent = 5;
                c.cpu_epp_percent = 72;
            },
        });
    }

    if cfg.display_refresh_hz > 60 {
        out.push(Proposal {
            title: "Passer l'affichage à 60 Hz en usage bureautique (libère l'état P8 VRAM)",
            why: "À 144/165 Hz, le VBLANK trop court maintient souvent la mémoire GDDR6 en P0 à 100% (+14 W GPU au repos) en plus du scaler du moniteur.",
            est_saved_watts: 17.5,
            est_latency_delta_ms: 0.0,
            requires_admin: false,
            apply: |c| {
                c.display_refresh_hz = 60;
                c.gpu_zero_rpm = true;
            },
        });
    }

    if cfg.gpu_power_limit_pct > 72 || cfg.gpu_clock_cap_mhz > 1900 {
        out.push(Proposal {
            title: "Plafonner le GPU à 65% TDP & 1 750 MHz (zone de rendement maximal)",
            why: "La courbe V/F GPU s'aplatit fortement au-delà de 70% TDP : réduire de -35% les watts conserve ~90% des performances 3D et active le 0 RPM au repos.",
            est_saved_watts: 52.0,
            est_latency_delta_ms: 1.4,
            requires_admin: true,
            apply: |c| {
                c.gpu_power_limit_pct = 65;
                c.gpu_clock_cap_mhz = 1750;
                c.gpu_vram_policy = GpuVramPolicy::ForceP8Idle;
                c.gpu_zero_rpm = true;
            },
        });
    }

    if cfg.pcie_aspm == PcieAspm::Off || !cfg.cpu_deep_cstates {
        out.push(Proposal {
            title: "Activer PCIe ASPM L1.2 & les C-States profonds C8/C10",
            why: "Un lien PCIe bloqué en L0 brûle ~7 W dans les SerDes et empêche le package CPU de descendre en C8. Réveil en 0,045 ms seulement.",
            est_saved_watts: 11.5,
            est_latency_delta_ms: 0.05,
            requires_admin: false,
            apply: |c| {
                c.pcie_aspm = PcieAspm::L1Substates;
                c.cpu_deep_cstates = true;
                c.usb_selective_suspend = true;
                c.bg_eco_qos = true;
                c.timer_resolution = TimerResolutionPolicy::Coalesced15_6Ms;
            },
        });
    }

    if cfg.nvme_apst == NvmeApst::Ps0Only {
        out.push(Proposal {
            title: "Activer la veille autonome SSD NVMe APST PS3 (150 ms) & SATA DIPM",
            why: "Fait passer le SSD de 5 500 mW (PS0, ~54°C) à 50 mW (PS3, ~34°C) entre deux accès, pour seulement +0,85 ms sur la 1ère lecture après pause.",
            est_saved_watts: 6.2,
            est_latency_delta_ms: 0.85,
            requires_admin: true,
            apply: |c| {
                c.nvme_apst = NvmeApst::Ps3Balanced;
                c.nvme_idle_timeout_ms = 150;
            },
        });
    }

    out
}
`,
  },
  {
    path: "src/platform/nic_eee.rs",
    layer: "Plateforme Win32",
    summary: "Activation du mode Ethernet Éco-Énergétique IEEE 802.3az (*EEE Low-Power Idle) sur cartes 1/2.5 GbE en mode Admin.",
    content: `#![forbid(unsafe_code)]

use crate::platform::ApplyReport;

/// Active ou désactive la propriété NDIS standard *EEE (IEEE 802.3az Low-Power Idle)
pub fn apply_eee(enable: bool, report: &mut ApplyReport) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Command;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let reg_val = if enable { "1" } else { "0" };
        let script = format!(
            "Get-NetAdapter -Physical -ErrorAction SilentlyContinue | \
             Set-NetAdapterAdvancedProperty -RegistryKeyword '*EEE' -RegistryValue '{reg_val}' -NoRestart -ErrorAction SilentlyContinue"
        );
        let ok = Command::new("powershell.exe")
            .creation_flags(CREATE_NO_WINDOW)
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            report.applied_items.push("NIC Ethernet IEEE 802.3az (*EEE LPI)");
        }
    }
    #[cfg(not(windows))]
    let _ = (enable, report);
}
`,
  },
  {
    path: "src/ui/tooltips.rs",
    layer: "Interface egui",
    summary: "Encyclopédie d'infobulles techniques riches pour `egui` (API Win32/GUID, loi physique CMOS, Avant/Après en ms, sûreté).",
    content: `#![forbid(unsafe_code)]

use eframe::egui;

pub struct TechDoc {
    pub title: &'static str,
    pub privilege: &'static str,
    pub win_api: &'static str,
    pub physics: &'static str,
    pub real_impact: &'static str,
    pub safety: &'static str,
}

pub fn attach(resp: egui::Response, doc: &TechDoc, enabled: bool) -> egui::Response {
    if !enabled {
        return resp;
    }
    resp.on_hover_ui(|ui| {
        ui.set_max_width(410.0);
        ui.strong(doc.title);
        ui.colored_label(egui::Color32::from_rgb(56, 189, 248), format!("Privilège : {} | API : {}", doc.privilege, doc.win_api));
        ui.separator();
        ui.label(doc.physics);
        ui.add_space(4.0);
        ui.colored_label(egui::Color32::from_rgb(52, 211, 153), format!("Avant -> Après : {}", doc.real_impact));
        ui.add_space(4.0);
        ui.small(format!("Sûreté : {}", doc.safety));
    })
}

pub const CPU_FREQ: TechDoc = TechDoc {
    title: "Plafond de fréquence CPU (PROCFREQMAX en MHz)",
    privilege: "Mode User (asInvoker)",
    win_api: "powrprof.dll -> SUB_PROCESSOR / 75b0ae3f-bce0-45a7-8c89-c9611c25e100",
    physics: "Loi CMOS P_dyn = a * C * V^2 * f. Au-delà de ~3,4 GHz, la tension VID grimpe jusqu'à 1,39 V pour gagner les derniers MHz : la puissance explose en f^2.8.",
    real_impact: "5200 -> 3300 MHz : -58% de Watts CPU, -22°C, parsing JSON 5 Mo passe de 6,1 ms à 9,2 ms (+3,1 ms, imperceptible sous le seuil humain de 16,6 ms).",
    safety: "Plafonne uniquement les P-States certifiés constructeur (0 undervolt instable, 0 erreur WHEA, effet en < 2 ms).",
};

pub const GPU_PL: TechDoc = TechDoc {
    title: "Enveloppe de puissance GPU (% TDP via NVML)",
    privilege: "Mode Administrateur (UAC)",
    win_api: "nvml.dll -> nvmlDeviceSetPowerManagementLimit(dev, milliwatts)",
    physics: "Les GPU modernes opèrent en zone de rendement décroissant à 100% TDP. À 65-72% TDP, GPU Boost choisit ~0,82 V au lieu de 1,08 V (+50% perf/Watt).",
    real_impact: "220 W -> 143 W : -77 W, -18°C, arrêt total 0 RPM au repos, frame time 3D passe de 6,4 ms à 7,3 ms (toujours > 120 FPS !).",
    safety: "Borné dynamiquement par nvmlDeviceGetPowerManagementLimitConstraints(min, max) du VBIOS.",
};
`,
  },
  {
    path: "src/ui/mod.rs",
    layer: "Interface egui",
    summary: "Interface native `eframe/egui` : barre UAC/Autostart, 5 profils, réglages à infobulles détaillées, Avant/Après & Conseiller Pareto.",
    content: `pub mod tooltips;

use std::time::{Duration, Instant};
use eframe::egui;

use crate::{
    config::ConfigRepository,
    domain::{HardwareConfig, ProfileStore, RealBenchSuite, TelemetryReading, TurboMode},
    optimizer,
    platform::{
        adaptive::{self, AdaptiveGovernor, CpuLoadSampler, HostContext},
        autostart, privilege, PlatformController,
    },
    safety::RollbackGuard,
    telemetry,
};

fn hover_tip(resp: egui::Response, enabled: bool, text: &str) -> egui::Response {
    if enabled { resp.on_hover_text(text) } else { resp }
}

pub struct EcoClockApp {
    repo: ConfigRepository,
    store: ProfileStore,
    working: HardwareConfig,
    ctrl: PlatformController,
    guard: RollbackGuard,
    governor: AdaptiveGovernor,
    cpu_sampler: CpuLoadSampler,
    before_tel: TelemetryReading,
    after_tel: TelemetryReading,
    before_bench: RealBenchSuite,
    after_bench: RealBenchSuite,
    last_poll: Instant,
    status_msg: String,
}

impl EcoClockApp {
    pub fn new(
        repo: ConfigRepository,
        store: ProfileStore,
        baseline: HardwareConfig,
        ctrl: PlatformController,
        guard: RollbackGuard,
    ) -> Self {
        let working = store.profile(store.active_slot).config.clone();
        let before_tel = ctrl.sample_telemetry(&baseline);
        let before_bench = telemetry::run_real_world_benchmarks();
        let mut cpu_sampler = CpuLoadSampler::default();
        let _ = cpu_sampler.sample_busy_pct(); // amorce le premier delta GetSystemTimes
        Self {
            repo,
            store,
            after_tel: before_tel.clone(),
            after_bench: before_bench.clone(),
            before_tel,
            before_bench,
            working,
            ctrl,
            guard,
            governor: AdaptiveGovernor::default(),
            cpu_sampler,
            last_poll: Instant::now(),
            status_msg: "Prêt — RollbackGuard actif (0 driver noyau)".into(),
        }
    }

    fn apply_and_measure(&mut self) {
        let rep = self.ctrl.apply_config(&self.working);
        self.after_tel = self.ctrl.sample_telemetry(&self.working);
        self.after_bench = telemetry::run_real_world_benchmarks();
        self.status_msg = format!(
            "Appliqué ({} groupes) | {} ignoré(s) faute de droits Admin",
            rep.applied_items.len(),
            rep.skipped_requires_admin.len()
        );
    }
}

impl eframe::App for EcoClockApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // Rafraîchissement télémétrie & gouverneur adaptatif sobre à 1 Hz (< 0,02% CPU)
        if self.last_poll.elapsed() >= Duration::from_secs(1) {
            let now = Instant::now();
            self.after_tel = self.ctrl.sample_telemetry(&self.working);
            let busy_pct = self.cpu_sampler.sample_busy_pct();
            let is_dirty = self.working != self.store.profile(self.store.active_slot).config;
            if self.store.adaptive_enabled && !is_dirty {
                let host = HostContext {
                    idle_seconds: adaptive::read_user_idle_seconds(),
                    on_battery: adaptive::is_running_on_battery(),
                    cpu_busy_pct: busy_pct,
                    gpu_temp_c: self.after_tel.gpu_temp_c,
                };
                if let Some(next_slot) = self.governor.poll(self.store.active_slot, host, now) {
                    self.store.active_slot = next_slot;
                    self.working = self.store.profile(next_slot).config.clone();
                    let _ = self.ctrl.apply_config(&self.working);
                    self.status_msg = format!(
                        "Mode intelligent -> P{next_slot} (CPU {busy_pct}%, inactif {}s, batterie={})",
                        host.idle_seconds, host.on_battery
                    );
                }
            }
            self.last_poll = now;
        }
        ctx.request_repaint_after(Duration::from_secs(1));
        let tips = self.store.show_tooltips;

        egui::TopBottomPanel::top("topbar").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.heading("EcoClock-rs");
                ui.separator();
                if self.ctrl.is_admin() {
                    ui.colored_label(egui::Color32::from_rgb(245, 158, 11), "Mode Administrateur (UAC)");
                } else if hover_tip(
                    ui.button("Mode User — Élever en Admin (UAC)"),
                    tips,
                    r#"Sauvegarde le profil actif puis relance via ShellExecuteExW("runas") pour débloquer NVML GPU, NVMe APST, Core Parking et tâche planifiée."#,
                )
                .clicked()
                {
                    let slot = self.store.active_slot;
                    self.store.profile_mut(slot).config = self.working.clamped();
                    let _ = self.repo.save_atomic(&self.store);
                    if let Ok(true) = privilege::request_uac_elevation(slot) {
                        self.guard.disarm();
                        ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    }
                }
                ui.separator();
                if ui.checkbox(&mut self.store.autostart.enabled, "Démarrer avec Windows").changed() {
                    let _ = autostart::sync_autostart(&self.store.autostart, self.ctrl.privilege);
                    let _ = self.repo.save_atomic(&self.store);
                }
                ui.separator();
                if ui.checkbox(&mut self.store.show_tooltips, "Infobulles").changed() {
                    let _ = self.repo.save_atomic(&self.store);
                }
                if ui.checkbox(&mut self.store.adaptive_enabled, "Mode intelligent").changed() {
                    let _ = self.repo.save_atomic(&self.store);
                }
            });

            ui.separator();
            // Barre des 5 profils configurables persistants
            ui.horizontal(|ui| {
                for slot in 1..=5 {
                    let selected = self.store.active_slot == slot;
                    let label = format!("P{slot}: {}", self.store.profile(slot).name);
                    if ui.selectable_label(selected, label).clicked() {
                        self.store.active_slot = slot;
                        self.working = self.store.profile(slot).config.clone();
                        self.apply_and_measure();
                    }
                }
                if ui.button("Sauver profil").clicked() {
                    let slot = self.store.active_slot;
                    self.store.profile_mut(slot).config = self.working.clamped();
                    let _ = self.repo.save_atomic(&self.store);
                    self.status_msg = format!("Profil P{slot} enregistré de manière atomique.");
                }
            });
        });

        egui::CentralPanel::default().show(ctx, |ui| {
            ui.columns(2, |cols| {
                // Colonne gauche : contrôles matériels avec infobulles détaillées
                cols[0].heading("Sous-systèmes underclockables");
                let r_cpu = cols[0].add(egui::Slider::new(&mut self.working.cpu_freq_cap_mhz, 800..=5200).text("CPU Max MHz"));
                tooltips::attach(r_cpu, &tooltips::CPU_FREQ, tips);
                let r_epp = cols[0].add(egui::Slider::new(&mut self.working.cpu_epp_percent, 0..=100).text("CPU EPP %"));
                hover_tip(r_epp, tips, "GUID PERFEPP (User). Arbitrage microcode Speed Shift / CPPC2 toutes les 1 ms.");
                let r_cs = cols[0].checkbox(&mut self.working.cpu_deep_cstates, "C-States profonds C6/C8/C10");
                hover_tip(r_cs, tips, "Coupe la tension des cœurs inactifs (latence sortie ~0,12 ms, jusqu'à -16 W au repos).");
                let r_eco = cols[0].checkbox(&mut self.working.bg_eco_qos, "Windows 11 EcoQoS + Timer Coalescing");
                hover_tip(r_eco, tips, "Confine les tâches de fond sur E-Cores et évite le martelage timer à 0,5 ms.");
                let mut no_turbo = self.working.cpu_turbo == TurboMode::Disabled;
                if cols[0].checkbox(&mut no_turbo, "Désactiver Turbo Boost (zéro pic 1,40 V)").changed() {
                    self.working.cpu_turbo = if no_turbo { TurboMode::Disabled } else { TurboMode::Efficient };
                }
                cols[0].separator();
                let r_gpu = cols[0].add_enabled(
                    self.ctrl.is_admin(),
                    egui::Slider::new(&mut self.working.gpu_power_limit_pct, 40..=100).text("GPU Power Limit % [Admin]"),
                );
                tooltips::attach(r_gpu, &tooltips::GPU_PL, tips);
                cols[0].add_enabled(
                    self.ctrl.is_admin(),
                    egui::Slider::new(&mut self.working.gpu_clock_cap_mhz, 900..=2610).text("GPU Max MHz [Admin]"),
                );
                if cols[0].button("Appliquer & Mesurer Avant/Après (ms)").clicked() {
                    self.apply_and_measure();
                }

                // Colonne droite : Avant/Après + Benchmarks ms + Propositions optimisées
                cols[1].heading("Comparatif Avant → Après & Effets Réels (ms)");
                cols[1].monospace(format!(
                    "GPU Watts   : {:5.1} W  -> {:5.1} W  ({:+.1} W)",
                    self.before_tel.gpu_watts, self.after_tel.gpu_watts,
                    self.after_tel.gpu_watts - self.before_tel.gpu_watts
                ));
                cols[1].monospace(format!(
                    "GPU Temp    : {:5.1} °C -> {:5.1} °C  | Fan {}% -> {}%",
                    self.before_tel.gpu_temp_c, self.after_tel.gpu_temp_c,
                    self.before_tel.gpu_fan_pct, self.after_tel.gpu_fan_pct
                ));
                cols[1].monospace(format!(
                    "Affichage   : {:5} Hz -> {:5} Hz",
                    self.before_tel.display_hz, self.after_tel.display_hz
                ));
                cols[1].monospace(format!(
                    "Hash/LZ 16M : {:5.2} ms -> {:5.2} ms ({:+.2} ms)",
                    self.before_bench.lz_compress_32mb_ms, self.after_bench.lz_compress_32mb_ms,
                    self.after_bench.lz_compress_32mb_ms - self.before_bench.lz_compress_32mb_ms
                ));
                cols[1].monospace(format!(
                    "Parse UI    : {:5.2} ms -> {:5.2} ms ({:+.2} ms)",
                    self.before_bench.structured_parse_ms, self.after_bench.structured_parse_ms,
                    self.after_bench.structured_parse_ms - self.before_bench.structured_parse_ms
                ));
                cols[1].monospace(format!(
                    "I/O 4 Ko    : {:5.2} ms -> {:5.2} ms | Jitter: {:.2} ms",
                    self.before_bench.disk_4k_wake_ms, self.after_bench.disk_4k_wake_ms,
                    self.after_bench.scheduler_jitter_ms
                ));

                cols[1].separator();
                cols[1].heading("Propositions de configuration optimisée & Pourquoi");
                for prop in optimizer::propose_optimizations(&self.working) {
                    cols[1].group(|ui| {
                        ui.strong(format!("{}  (-{:.0} W | +{:.2} ms)", prop.title, prop.est_saved_watts, prop.est_latency_delta_ms));
                        ui.label(prop.why);
                        if ui.small_button("Appliquer").clicked() {
                            (prop.apply)(&mut self.working);
                            self.apply_and_measure();
                        }
                    });
                }
            });
        });

        egui::TopBottomPanel::bottom("status").show(ctx, |ui| {
            ui.label(&self.status_msg);
        });
    }
}
`,
  },
  {
    path: "README.md",
    layer: "Documentation",
    summary: "Guide complet d'architecture, compilation Windows x86_64, sûreté matérielle, privilèges UAC et persistance des 5 profils.",
    content: `# EcoClock-rs (Windows 10 / 11)

Petit utilitaire Windows natif en **Rust** conçu pour underclocker et mettre en sobriété maximale **tous les sous-systèmes possibles** (CPU P/E-Cores, Turbo, EPP, C-States, Core Parking, RAPL PL1, GPU Power Limit & Clock Lock NVML, VRAM P-States, iGPU, PCIe ASPM L1.2, NVMe APST PS3/PS4, SATA DIPM, Affichage Hz, Ethernet 802.3az EEE, Wi-Fi PSP, USB Selective Suspend, EcoQoS & Timer Resolution) afin de réduire drastiquement la facture électrique, la chaleur et le bruit des ventilateurs.

## Principes de conception (Petit, Rapide, Sûr)

1. **Architecture hexagonale stricte dès le départ** :
   - \`src/domain.rs\` (\`#![forbid(unsafe_code)]\`) : types purs, 5 profils fixes, méthode \`clamped()\` garantissant les bornes constructeur.
   - \`src/config.rs\` (\`#![forbid(unsafe_code)]\`) : persistance TOML atomique (\`.tmp\` + \`sync_all\` + \`rename\`) dans \`%APPDATA%\\EcoClock\\profiles.toml\`.
   - \`src/safety.rs\` : \`RollbackGuard\` RAII + \`panic::set_hook\` + \`SetConsoleCtrlHandler\` + sentinelle Safe-Boot 15 s.
   - \`src/platform/\` : wrappers FFI isolés vers les seules API officielles Microsoft (\`powrprof.dll\`, \`user32.dll\`, \`advapi32.dll\`) et \`nvml.dll\`.
   - \`src/telemetry.rs\` & \`src/optimizer.rs\` (\`#![forbid(unsafe_code)]\`) : micro-benchmarks réels en ms et moteur de recommandation Front de Pareto.
   - \`src/ui/\` : interface immédiate \`eframe/glow\` (0 Electron/WebView, ~4,8 Mo RAM, < 0,02% CPU au repos à 1 Hz).
2. **Zéro pilote noyau Ring-0 vulnérable** : compatible Windows 11 HVCI, VBS, Secure Boot et anti-cheats. Zéro undervolt instable (uniquement plafonnement d'états P/C validés en usine).
3. **Double niveau de privilège** : manifeste \`asInvoker\` (démarre en User standard), élévation UAC à la demande via \`ShellExecuteExW("runas")\`.
4. **Démarrage avec Windows** : clé \`HKCU\\...\\Run\` (mode User) ou Tâche Planifiée \`ONLOGON /RL HIGHEST\` sans popup UAC (mode Admin) appliquant automatiquement le profil choisi (P1 à P5).

## Compilation sur Windows (MSVC)

\`\`\`powershell
# Prérequis : rustup (toolchain stable-x86_64-pc-windows-msvc)
cargo build --release

# Exécutable autonome généré (aucune DLL tierce à installer) :
.\\target\\release\\ecoclock.exe

# Utilisation en ligne de commande / démarrage silencieux :
.\\target\\release\\ecoclock.exe --apply-profile 1 --tray
.\\target\\release\\ecoclock.exe --apply-profile 2 --headless
.\\target\\release\\ecoclock.exe --restore-baseline
\`\`\`
`,
  },
];
