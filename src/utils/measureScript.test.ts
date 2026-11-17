import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Le banc de mesure vit hors de `src/` : rien ne vérifie sa syntaxe au build.
 * `-DryRun` le charge, appelle `powrprof` en lecture seule et affiche la matrice,
 * sans écrire dans le plan d'alimentation. C'est le seul mode exécutable en CI.
 */

const WINDOWS = process.platform === "win32";

describe.skipIf(!WINDOWS)("banc de mesure CPPC2", () => {
  it(
    "se charge et lit le plan sans rien écrire (-DryRun)",
    () => {
      const run = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.resolve("scripts/measure-cppc.ps1"),
          "-DryRun",
        ],
        { encoding: "utf8", timeout: 90_000 }
      );

      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout).toContain("Matrice");
      expect(run.stdout).toContain("ref-debut");
      expect(run.stdout).toContain("Initial");
    },
    120_000
  );
});
