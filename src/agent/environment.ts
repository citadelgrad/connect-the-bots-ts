import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import type {
  ExecutionEnvironment,
  ExecResult,
  GrepOptions,
} from "./types.js";

const execFileAsync = promisify(execFile);

const SENSITIVE_ENV_PATTERNS = [
  /_API_KEY$/,
  /_SECRET$/,
  /_TOKEN$/,
  /_PASSWORD$/,
  /^AWS_/,
  /^ANTHROPIC_API_KEY$/,
  /^OPENAI_API_KEY$/,
  /^GEMINI_API_KEY$/,
];

function filterEnv(): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const isSensitive = SENSITIVE_ENV_PATTERNS.some((p) => p.test(key));
    if (!isSensitive) {
      filtered[key] = value;
    }
  }
  return filtered;
}

export class LocalExecutionEnvironment implements ExecutionEnvironment {
  private workDir: string;

  constructor(workingDirectory?: string) {
    this.workDir = workingDirectory ?? process.cwd();
  }

  async read_file(
    filePath: string,
    offset?: number,
    limit?: number
  ): Promise<string> {
    const abs = path.resolve(this.workDir, filePath);
    const content = await fs.readFile(abs, "utf-8");
    const lines = content.split("\n");

    const startLine = offset ? offset - 1 : 0; // 1-based to 0-based
    const endLine = limit ? startLine + limit : lines.length;
    const slice = lines.slice(startLine, endLine);

    return slice
      .map((line, i) => {
        const lineNum = String(startLine + i + 1).padStart(4, " ");
        return `${lineNum}\t${line}`;
      })
      .join("\n");
  }

  async write_file(filePath: string, content: string): Promise<void> {
    const abs = path.resolve(this.workDir, filePath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
  }

  async file_exists(filePath: string): Promise<boolean> {
    try {
      const abs = path.resolve(this.workDir, filePath);
      await fs.access(abs);
      return true;
    } catch {
      return false;
    }
  }

  async list_directory(
    dirPath: string,
    depth = 1
  ): Promise<string[]> {
    const abs = path.resolve(this.workDir, dirPath);
    const results: string[] = [];

    async function walk(dir: string, currentDepth: number): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = path.relative(abs, path.join(dir, entry.name));
        results.push(entry.isDirectory() ? rel + "/" : rel);
        if (entry.isDirectory() && currentDepth < depth) {
          await walk(path.join(dir, entry.name), currentDepth + 1);
        }
      }
    }

    await walk(abs, 1);
    return results;
  }

  async exec_command(
    command: string,
    timeout_ms?: number,
    working_dir?: string,
    env_vars?: Record<string, string>
  ): Promise<ExecResult> {
    const cwd = working_dir
      ? path.resolve(this.workDir, working_dir)
      : this.workDir;

    const effectiveTimeout = timeout_ms ?? 10000;
    const shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs =
      process.platform === "win32" ? ["/c", command] : ["-c", command];

    const start = Date.now();
    return new Promise<ExecResult>((resolve) => {
      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...filterEnv(), ...(env_vars ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid && process.platform !== "win32") {
            process.kill(-child.pid, "SIGTERM");
            setTimeout(() => {
              try {
                process.kill(-child.pid!, "SIGKILL");
              } catch {
                // already dead
              }
            }, 2000);
          } else {
            child.kill("SIGTERM");
          }
        } catch {
          // already dead
        }
      }, effectiveTimeout);

      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr,
          exit_code: code ?? 1,
          timed_out: timedOut,
          duration_ms: Date.now() - start,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          stdout,
          stderr: stderr + "\n" + err.message,
          exit_code: 1,
          timed_out: false,
          duration_ms: Date.now() - start,
        });
      });
    });
  }

  async grep(
    pattern: string,
    searchPath: string,
    options?: GrepOptions
  ): Promise<string> {
    const abs = path.resolve(this.workDir, searchPath);
    const args = ["-rn"];
    if (options?.case_insensitive) args.push("-i");
    if (options?.max_results) args.push("-m", String(options.max_results));
    if (options?.glob_filter) args.push(`--include=${options.glob_filter}`);
    args.push(pattern, abs);

    try {
      const { stdout } = await execFileAsync("grep", args, {
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (err: unknown) {
      // grep returns exit code 1 when no matches found
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === 1
      ) {
        return "";
      }
      throw err;
    }
  }

  async glob(pattern: string, searchPath?: string): Promise<string[]> {
    const base = searchPath
      ? path.resolve(this.workDir, searchPath)
      : this.workDir;

    // Use find for simple glob matching
    const args = [base, "-name", pattern, "-type", "f"];
    try {
      const { stdout } = await execFileAsync("find", args, {
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((p) => path.relative(this.workDir, p));
    } catch {
      return [];
    }
  }

  working_directory(): string {
    return this.workDir;
  }

  platform(): string {
    return process.platform;
  }

  os_version(): string {
    return `${os.type()} ${os.release()}`;
  }
}
