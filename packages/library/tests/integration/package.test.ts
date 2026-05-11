import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createProgram } from "../../src/cli/runner";

const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8"));

describe("Package Configuration", () => {
  test("package.json has all required fields", () => {
    expect(pkg.name).toBe("trackgentic");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.type).toBe("module");
    expect(pkg.main).toBe("src/index.ts");
    expect(pkg.types).toBe("src/index.ts");
    expect(pkg.exports).toEqual({ ".": "./src/index.ts" });
    expect(pkg.bin).toEqual({ trackgentic: "./src/bin.ts" });
    expect(pkg.files).toEqual(["src/"]);
    expect(pkg.description).toBeString();
    expect(pkg.description.length).toBeGreaterThan(0);
    expect(pkg.scripts.prepublishOnly).toBe("bun run quality");
  });

  test("CLI --help flag produces help output", async () => {
    const program = createProgram();
    program.exitOverride(); // Prevent process.exit

    let helpOutput = "";
    program.configureOutput({
      writeOut: (str: string) => {
        helpOutput = str;
      },
    });

    try {
      await program.parseAsync(["node", "trackgentic", "--help"]);
    } catch {
      // Commander throws after printing help — expected
    }

    expect(helpOutput).toContain("trackgentic");
    expect(helpOutput).toContain("init");
    expect(helpOutput).toContain("create");
    expect(helpOutput).toContain("list");
  });

  test("CLI --version flag produces version output", async () => {
    const program = createProgram();
    program.exitOverride();

    let versionOutput = "";
    program.configureOutput({
      writeOut: (str: string) => {
        versionOutput = str;
      },
    });

    try {
      await program.parseAsync(["node", "trackgentic", "--version"]);
    } catch {
      // Commander throws after printing version — expected
    }

    expect(versionOutput.trim()).toBe("0.1.0");
  });
});
