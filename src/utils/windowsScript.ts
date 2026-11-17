import { HardwareConfig, HardwareProfile, Profile } from "../types/hardware";
import { clampConfigToProfile } from "../engine/validation";

/** Nettoie toute chaîne insérée en commentaire PowerShell (supprime retours ligne et caractères de contrôle). */
function safePsComment(input: string): string {
  return input.replace(/[\r\n\u0000-\u001F\u007F]/g, " ").trim().slice(0, 80);
}

/**
 * Génère un script PowerShell Windows 10/11 autonome, lisible et réversible appliquant
 * le profil donné via les seuls outils Microsoft/NVIDIA officiels (`powercfg.exe`, `nvidia-smi.exe`, `NetAdapter`).
 * - Sauvegarde d'abord le plan d'alimentation actif dans `%APPDATA%\EcoClock\backup-scheme.pow` ;
 * - Applique tous les réglages User sans UAC ;
 * - Détecte automatiquement si le jeton est élevé (`Administrator`) avant d'exécuter NVML / NVMe APST / EEE ;
 * - Supporte `.\apply-ecoclock.ps1 -Restore` pour revenir instantanément à l'état initial.
 */
export function buildWindowsPowerShellScript(
  profile: Profile,
  rawConfig: HardwareConfig,
  hardware: HardwareProfile
): string {
  const c = clampConfigToProfile(rawConfig, hardware);
  const safeName = safePsComment(profile.name);
  const safeHw = safePsComment(hardware.label);

  const turboIdx = c.cpuTurboMode === "disabled" ? 0 : c.cpuTurboMode === "efficient" ? 3 : 2;
  const freqCapVal = c.cpuFreqCapMhz >= hardware.cpuFreqMaxMhz ? 0 : c.cpuFreqCapMhz;
  const idleDisable = c.cpuDeepCStates ? 0 : 1;
  const aspmIdx = c.pcieAspm === "off" ? 0 : c.pcieAspm === "l0s" ? 1 : 2;
  const usbIdx = c.usbSelectiveSuspend ? 1 : 0;
  const wifiIdx = c.wifiPowerMode === "cam" ? 0 : c.wifiPowerMode === "medium_psp" ? 2 : 3;
  const igpuIdx = c.igpuEcoClock ? 0 : 2;
  const noppme = c.nvmeApst === "ps0_only" ? 0 : 1;
  const alpmIdx = c.sataAlpm === "active" ? 0 : c.sataAlpm === "hipm" ? 1 : 3;
  const gpuTargetWatts = Math.max(30, Math.round((hardware.gpuTdpW * c.gpuPowerLimitPct) / 100));
  const eeeVal = c.nicEeeEnabled ? "1" : "0";

  const lines: string[] = [
    `#Requires -Version 5.1`,
    `# EcoClock-rs — Script autonome d'application & de restauration (0 pilote noyau)`,
    `# Profil : P${profile.id} - ${safeName} | Matériel calibré : ${safeHw}`,
    `# Usage  : .\\ecoclock-p${profile.id}.ps1           (applique User, + Admin si console élevée)`,
    `# Secours: .\\ecoclock-p${profile.id}.ps1 -Restore  (restaure la sauvegarde initiale)`,
    ``,
    `param([switch]$Restore)`,
    `$ErrorActionPreference = 'Stop'`,
    ``,
    `$BackupDir  = Join-Path $env:APPDATA 'EcoClock'`,
    `$BackupFile = Join-Path $BackupDir 'baseline-scheme.pow'`,
    `New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null`,
    ``,
    `$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()`,
    `$IsAdmin  = ([Security.Principal.WindowsPrincipal]$Identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)`,
    ``,
    `if ($Restore) {`,
    `    $Restored = $false`,
    `    if (Test-Path $BackupFile) {`,
    `        # powercfg peut renvoyer plusieurs lignes : on aplatit avant de chercher le GUID,`,
    `        # sinon -match travaille sur un tableau et $Matches peut rester vide.`,
    `        $imported = (powercfg.exe /import $BackupFile | Out-String)`,
    `        $guid = [regex]::Match($imported, '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})')`,
    `        if ($guid.Success) {`,
    `            powercfg.exe /setactive $guid.Groups[1].Value | Out-Null`,
    `            $Restored = ($LASTEXITCODE -eq 0)`,
    `        }`,
    `        if ($Restored) {`,
    `            Write-Host '[OK] Plan d''alimentation initial restauré.' -ForegroundColor Green`,
    `        } else {`,
    `            Write-Host "[ERREUR] Restauration impossible : $($imported.Trim())" -ForegroundColor Red`,
    `        }`,
    `    } else {`,
    `        Write-Host "[ERREUR] Aucune sauvegarde dans $BackupFile : rien à restaurer." -ForegroundColor Red`,
    `    }`,
    `    if ($IsAdmin -and (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue)) {`,
    `        nvidia-smi.exe -rgc | Out-Null`,
    `        Write-Host '[OK] Horloges GPU NVIDIA réinitialisées.' -ForegroundColor Green`,
    `    }`,
    `    exit $(if ($Restored) { 0 } else { 1 })`,
    `}`,
    ``,
    `# 1. Photographie de sécurité du plan actif (une seule fois avant la 1re modification)`,
    `if (-not (Test-Path $BackupFile)) {`,
    `    $active = (powercfg.exe /getactivescheme)`,
    `    if ($active -match '([0-9a-fA-F-]{36})') {`,
    `        powercfg.exe /export $BackupFile $Matches[1] | Out-Null`,
    `        Write-Host "[SAFE] Baseline sauvegardée dans $BackupFile" -ForegroundColor Cyan`,
    `    }`,
    `}`,
    ``,
    `$script:Applied = 0`,
    `$script:Skipped = New-Object System.Collections.Generic.List[string]`,
    ``,
    `# Détection de capacité : le code retour de powercfg fait foi. Une policy absente du`,
    `# catalogue Windows (ou verrouillée) est comptée puis annoncée, jamais ignorée en silence.`,
    `function Set-PowerIndex([string]$Sub, [string]$Setting, [uint32]$Val, [string]$Name) {`,
    `    # Stop + stderr natif = NativeCommandError terminant : on repasse en Continue le temps des appels.`,
    `    $previous = $ErrorActionPreference`,
    `    $ErrorActionPreference = 'Continue'`,
    `    powercfg.exe /setacvalueindex SCHEME_CURRENT $Sub $Setting $Val 2>&1 | Out-Null`,
    `    $ac = $LASTEXITCODE`,
    `    powercfg.exe /setdcvalueindex SCHEME_CURRENT $Sub $Setting $Val 2>&1 | Out-Null`,
    `    $dc = $LASTEXITCODE`,
    `    $ErrorActionPreference = $previous`,
    `    if ($ac -ne 0 -or $dc -ne 0) { $script:Skipped.Add($Name); return }`,
    `    $script:Applied++`,
    `}`,
    ``,
    `# 2. Réglages Mode Utilisateur (aucun droit Admin requis)`,
    `Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' '893dee8e-2bef-41e0-89c6-b55d0929964c' ${c.cpuMinPercent} 'PROCTHROTTLEMIN'    # PROCTHROTTLEMIN (%)`,
    `Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' 'bc5038f7-23e0-4960-96da-33abaf5935ec' ${c.cpuMaxPercent} 'PROCTHROTTLEMAX'    # PROCTHROTTLEMAX (%)`,
    `Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' '75b0ae3f-bce0-45a7-8c89-c9611c25e100' ${freqCapVal} 'PROCFREQMAX'  # PROCFREQMAX (MHz, 0=max)`,
    `Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' 'be337238-0d82-4146-a960-4f3749d470c7' ${turboIdx} 'PERFBOOSTMODE'    # PERFBOOSTMODE`,
    `Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' '36687f9e-e3a5-4dbf-b1dc-15eb381c6863' ${c.cpuEpp} 'PERFEPP'    # PERFEPP (%)`,
    `Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' '5d76a2ca-e8c0-402f-a133-2158492d58ad' ${idleDisable} 'IDLEDISABLE'    # IDLEDISABLE (0=C-States ON)`,
    `Set-PowerIndex '501a4d13-42af-4429-9fd1-a8218c268e20' 'ee12f906-d277-404b-b6da-e5fa1a576df5' ${aspmIdx} 'PCIE_ASPM'    # PCIe ASPM`,
    `Set-PowerIndex '2a737441-1930-4402-8d77-b2bebba308a3' '48e6b7a6-50f5-4782-a5d4-53bb8f07e226' ${usbIdx} 'USB_SELECTIVE'    # USB Selective Suspend`,
    `Set-PowerIndex '19cbb8fa-5279-450e-9fac-8a3d5fedd0c1' '12bbebe6-58d6-4636-95bb-3217ef867c1a' ${wifiIdx} 'WIFI_PSM'    # Wi-Fi Power Saving`,
    `Set-PowerIndex '44f3beca-a7c0-460e-9df2-bb8b99e0cba6' '3619c3f2-afb2-4afc-b0e9-e7fef372de36' ${igpuIdx} 'IGPU_BIAS'    # iGPU Power Bias`,
    ``,
    `# 3. Réglages Mode Administrateur (si console élevée)`,
    `if ($IsAdmin) {`,
    `    Set-PowerIndex '54533251-82be-4824-96c1-47b60b740d00' '0cc5b647-c1df-4637-891a-dec35c318583' ${c.cpuCoreParkingMinActive} 'CPMINCORES' # Core Parking min (%)`,
    `    Set-PowerIndex '0012ee47-9041-4b5d-9b77-535fba8b1442' 'fc95af4d-40e7-4b6d-835a-56d131dbc80e' ${noppme} 'NVME_NOPPME'  # NVMe NOPPME (APST)`,
    `    Set-PowerIndex '0012ee47-9041-4b5d-9b77-535fba8b1442' 'd639518a-e56d-4345-8af2-b9f32fb26109' ${c.nvmeIdleTimeoutMs} 'NVME_IDLE_MS' # NVMe Idle Timeout (ms)`,
    `    Set-PowerIndex '0012ee47-9041-4b5d-9b77-535fba8b1442' '0b2d69d7-a2a1-449c-9680-f91c70521c60' ${alpmIdx} 'AHCI_ALPM'  # SATA AHCI ALPM`,
    `    Get-NetAdapter -Physical -ErrorAction SilentlyContinue |`,
    `        Set-NetAdapterAdvancedProperty -RegistryKeyword '*EEE' -RegistryValue '${eeeVal}' -NoRestart -ErrorAction SilentlyContinue`,
  ];

  if (hardware.hasDedicatedGpu) {
    lines.push(
      `    if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {`,
      `        nvidia-smi.exe -pl ${gpuTargetWatts} | Out-Null`,
      c.gpuCoreClockCapMhz >= hardware.gpuMaxClockMhz
        ? `        nvidia-smi.exe -rgc | Out-Null`
        : `        nvidia-smi.exe -lgc 210,${c.gpuCoreClockCapMhz} | Out-Null`,
      `    }`
    );
  }

  lines.push(
    `} else {`,
    `    Write-Host '[INFO] Mode User : relancez en Administrateur pour appliquer aussi NVML GPU, NVMe APST, Core Parking et EEE.' -ForegroundColor Yellow`,
    `}`,
    ``,
    `powercfg.exe /setactive SCHEME_CURRENT`,
    `if ($script:Skipped.Count -gt 0) {`,
    `    Write-Host "[INFO] Refusés par Windows (policy absente ou verrouillée) : $($script:Skipped -join ', ')." -ForegroundColor Yellow`,
    `}`,
    `Write-Host "[OK] Profil P${profile.id} appliqué : $($script:Applied) réglage(s), $($script:Skipped.Count) ignoré(s). Utilisez -Restore pour annuler." -ForegroundColor Green`,
    ``
  );

  return lines.join("\r\n");
}
