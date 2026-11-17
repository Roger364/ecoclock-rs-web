import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROFILES } from "../data/profiles";
import { HARDWARE_PROFILES } from "../data/hardwareProfiles";
import { buildWindowsPowerShellScript } from "./windowsScript";

/**
 * Test exécutable du script livré : il ne se contente pas de vérifier le texte,
 * il lance `powershell -File` sur le script réellement généré.
 *
 * Rien ne touche au système : `powercfg.exe`, `nvidia-smi.exe` et les cmdlets
 * réseau sont masqués par des fonctions PowerShell, et `APPDATA` pointe vers un
 * dossier temporaire. On exerce donc le vrai code (compteurs, liste des refus,
 * restauration) sans modifier le plan d'alimentation de la machine.
 */

const WINDOWS = process.platform === "win32";
const PS = "powershell.exe";

/** Littéral PowerShell entre quotes simples (une apostrophe se double). */
const ps = (value: string) => `'${value.replace(/'/g, "''")}'`;

const PROCFREQMAX_GUID = "75b0ae3f-bce0-45a7-8c89-c9611c25e100";

type Run = { code: number | null; out: string };

function runGeneratedScript(opts: {
  restore?: boolean;
  refuseSetting?: string;
  importOutput?: string;
  withBackup?: boolean;
}): Run {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ecoclock-ps-"));
  const appdata = path.join(dir, "appdata");
  fs.mkdirSync(appdata, { recursive: true });

  if (opts.withBackup) {
    fs.mkdirSync(path.join(appdata, "EcoClock"), { recursive: true });
    fs.writeFileSync(path.join(appdata, "EcoClock", "baseline-scheme.pow"), "stub");
  }

  const scriptPath = path.join(dir, "apply-ecoclock.ps1");
  fs.writeFileSync(
    scriptPath,
    buildWindowsPowerShellScript(DEFAULT_PROFILES[0], DEFAULT_PROFILES[0].config, HARDWARE_PROFILES[0]),
    "utf8"
  );

  const refuse = opts.refuseSetting ?? "";
  const importOutput = opts.importOutput ?? "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)";

  const harness = path.join(dir, "harness.ps1");
  const outFile = path.join(dir, "out.txt");
  fs.writeFileSync(
    harness,
    [
      `$env:APPDATA = ${ps(appdata)}`,
      ``,
      `# Exécutables masqués : le script s'exécute, le système n'est pas touché.`,
      `function global:powercfg.exe {`,
      `  param([Parameter(ValueFromRemainingArguments = $true)]$a)`,
      `  switch ($a[0]) {`,
      `    '/getactivescheme' { Write-Output 'Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced)'; $global:LASTEXITCODE = 0 }`,
      `    '/import' { Write-Output ${ps(importOutput)}; $global:LASTEXITCODE = 0 }`,
      `    '/setacvalueindex' { if ($a[3] -eq '${refuse}') { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 } }`,
      `    default { $global:LASTEXITCODE = 0 }`,
      `  }`,
      `}`,
      `function global:Get-NetAdapter { param([switch]$Physical, $ErrorAction) }`,
      `function global:Set-NetAdapterAdvancedProperty { param($RegistryKeyword, $RegistryValue, [switch]$NoRestart, $ErrorAction) }`,
      `function global:nvidia-smi.exe { param([Parameter(ValueFromRemainingArguments = $true)]$a) }`,
      ``,
      `# 6>&1 capture Write-Host (flux d'information depuis PowerShell 5).`,
      `# L'écriture en fichier UTF-8 évite toute dépendance à la page de code de la console.`,
      `try { $sortie = & ${ps(scriptPath)}${opts.restore ? " -Restore" : ""} 6>&1 | Out-String }`,
      `catch { $sortie = "HARNESS_ERROR: $_" }`,
      `$code = $LASTEXITCODE`,
      `[System.IO.File]::WriteAllText(${ps(outFile)}, $sortie, (New-Object System.Text.UTF8Encoding $false))`,
      `exit $code`,
      ``,
    ].join("\r\n"),
    "utf8"
  );

  const r = spawnSync(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness], {
    encoding: "utf8",
    timeout: 60_000,
  });
  const written = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  return { code: r.status, out: `${written}${r.stderr ?? ""}` };
}

describe.skipIf(!WINDOWS)("script .ps1 généré, exécuté pour de vrai", () => {
  it("commence par un BOM UTF-8, sinon PowerShell 5.1 lit le fichier en ANSI", () => {
    const script = buildWindowsPowerShellScript(
      DEFAULT_PROFILES[0],
      DEFAULT_PROFILES[0].config,
      HARDWARE_PROFILES[0]
    );
    expect(script.charCodeAt(0)).toBe(0xfeff);
  });

  it(
    "applique le profil, compte un réglage refusé par Windows et l'annonce",
    () => {
      const { code, out } = runGeneratedScript({ refuseSetting: PROCFREQMAX_GUID });

      expect(code, out).toBe(0);
      expect(out).toContain("[SAFE] Baseline sauvegardée");
      // Le contrat exact que la vague 5 avait cassé en silence.
      const report = /\[OK\] Profil P1 appliqué : (\d+) réglage\(s\), 1 ignoré\(s\)/.exec(out);
      expect(report).not.toBeNull();
      // 9 en User, 13 si la console de test est élevée (4 réglages Admin en plus).
      expect(Number(report![1])).toBeGreaterThanOrEqual(9);
      expect(out).toContain("[INFO] Refusés par Windows (policy absente ou verrouillée) : PROCFREQMAX.");
    },
    60_000
  );

  it(
    "restaure la sauvegarde même quand powercfg /import renvoie plusieurs lignes",
    () => {
      const { code, out } = runGeneratedScript({
        restore: true,
        withBackup: true,
        importOutput:
          "Importing power scheme...\nPower Scheme GUID: 11111111-2222-3333-4444-555555555555  (EcoClock baseline)\n",
      });

      expect(code, out).toBe(0);
      expect(out).toContain("[OK] Plan d'alimentation initial restauré.");
    },
    60_000
  );

  it(
    "échoue proprement quand l'import ne contient aucun GUID",
    () => {
      const { code, out } = runGeneratedScript({
        restore: true,
        withBackup: true,
        importOutput: "Le fichier spécifié est introuvable.",
      });

      expect(code, out).toBe(1);
      expect(out).toContain("[ERREUR] Restauration impossible");
    },
    60_000
  );
});
