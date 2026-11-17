#!/usr/bin/env node
/**
 * Vérifie que le projet Rust livré par l'onglet « Source Rust » compile réellement.
 *
 * Le crate n'existe nulle part sur le disque : il est reconstitué à partir des
 * littéraux de `src/data/rustProject.ts` + `rustExtras.ts`. Deux classes de bugs
 * échappent donc à `tsc` :
 *
 *   1. la structure TOML du manifeste (une dépendance placée sous `[features]`
 *      rend le fichier inanalysable par Cargo) ;
 *   2. les échappements de chaînes Rust (`\"`, `\\`), détruits par les gabarits
 *      TypeScript qui les contiennent.
 *
 * Ce script extrait le crate et lance `cargo check` dessus. Il échoue si le
 * crate ne compile pas, ce qui rend la régression détectable avant livraison.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const workDir = path.join(root, ".check-rust");
const keep = process.argv.includes("--keep");

async function loadModule(entry) {
  const result = await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    logLevel: "silent",
  });
  const code = Buffer.from(result.outputFiles[0].text, "utf8").toString("base64");
  return import(`data:text/javascript;base64,${code}`);
}

function fail(message) {
  console.error(`\n  échec : ${message}\n`);
  process.exitCode = 1;
}

fs.rmSync(workDir, { recursive: true, force: true });
fs.mkdirSync(workDir, { recursive: true });

const { RUST_PROJECT_FILES } = await loadModule("src/data/rustProject.ts");
const { RUST_EXTRA_FILES } = await loadModule("src/data/rustExtras.ts");

const files = [...RUST_PROJECT_FILES, ...RUST_EXTRA_FILES];
const seen = new Set();

for (const file of files) {
  if (seen.has(file.path)) {
    fail(`chemin dupliqué dans le projet Rust : ${file.path}`);
    break;
  }
  seen.add(file.path);
  const target = path.join(workDir, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, file.content, "utf8");
}

if (files.length === 0) fail("aucun fichier Rust extrait");
else if (!process.exitCode) {
  console.log(`${files.length} fichiers Rust extraits dans ${path.relative(root, workDir)}`);

  // Commande unique + shell : évite l'avertissement Node sur args non échappés,
  // et fonctionne sur Windows où `cargo` est résolu via le PATH du shell.
  const cargo = spawnSync("cargo check --all-targets --quiet", {
    cwd: workDir,
    stdio: ["ignore", "inherit", "inherit"],
    shell: true,
  });

  if (cargo.error) {
    fail(`cargo introuvable ou non exécutable (${cargo.error.message})`);
  } else if (cargo.status !== 0) {
    fail(`cargo check a retourné ${cargo.status} — le crate livré ne compile pas`);
  } else {
    console.log("cargo check --all-targets : OK — le crate et ses tests compilent");
  }
}

if (!keep && !process.exitCode) fs.rmSync(workDir, { recursive: true, force: true });
else console.log(`fichiers conservés dans ${path.relative(root, workDir)} pour inspection`);
