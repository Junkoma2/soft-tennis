import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(projectRoot, "mobile-dist");

if (path.dirname(outputDir) !== projectRoot || path.basename(outputDir) !== "mobile-dist") {
  throw new Error(`Unexpected mobile output directory: ${outputDir}`);
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const rootEntries = await readdir(projectRoot, { withFileTypes: true });
const webExtensions = new Set([".css", ".html", ".js"]);
const webFiles = rootEntries
  .filter((entry) => entry.isFile() && webExtensions.has(path.extname(entry.name)))
  .map((entry) => entry.name);

await Promise.all(
  webFiles.map((file) => cp(path.join(projectRoot, file), path.join(outputDir, file))),
);
await cp(path.join(projectRoot, "vendor"), path.join(outputDir, "vendor"), { recursive: true });

console.log(`Prepared ${webFiles.length} web files and vendor assets in mobile-dist.`);
