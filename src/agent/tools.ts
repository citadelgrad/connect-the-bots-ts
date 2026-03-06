import type { ToolDefinition } from "../llm/types.js";
import type {
  RegisteredTool,
  ToolRegistry,
  ExecutionEnvironment,
} from "./types.js";

// ─── Core Tool Implementations ─────────────────────────────────────────────

function makeReadFile(): RegisteredTool {
  return {
    definition: {
      name: "read_file",
      description:
        "Read a file from the filesystem. Returns line-numbered content. " +
        "Use offset and limit for large files.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Path to the file to read" },
          offset: {
            type: "integer",
            description: "1-based line number to start reading from",
          },
          limit: {
            type: "integer",
            description: "Number of lines to read (default 2000)",
          },
        },
        required: ["file_path"],
      },
    },
    executor: async (args, env) => {
      const filePath = args.file_path as string;
      const offset = args.offset as number | undefined;
      const limit = args.limit as number | undefined;
      return env.read_file(filePath, offset, limit);
    },
  };
}

function makeWriteFile(): RegisteredTool {
  return {
    definition: {
      name: "write_file",
      description:
        "Write content to a file. Creates parent directories if needed. " +
        "Overwrites existing file content.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to write",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
    executor: async (args, env) => {
      const filePath = args.file_path as string;
      const content = args.content as string;
      await env.write_file(filePath, content);
      const bytes = Buffer.byteLength(content, "utf-8");
      return `File written: ${filePath} (${bytes} bytes)`;
    },
  };
}

function makeEditFile(): RegisteredTool {
  return {
    definition: {
      name: "edit_file",
      description:
        "Edit a file by replacing an exact string match. " +
        "old_string must be unique in the file unless replace_all is true.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Path to the file to edit",
          },
          old_string: {
            type: "string",
            description: "Exact string to find and replace (must be unique)",
          },
          new_string: {
            type: "string",
            description: "String to replace old_string with",
          },
          replace_all: {
            type: "boolean",
            description:
              "Replace all occurrences instead of just the first (default false)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
    executor: async (args, env) => {
      const filePath = args.file_path as string;
      const oldStr = args.old_string as string;
      const newStr = args.new_string as string;
      const replaceAll = (args.replace_all as boolean) ?? false;

      const content = await env.read_file(filePath);
      // Strip line numbers from read_file output to get raw content
      const rawContent = content
        .split("\n")
        .map((line) => {
          const match = line.match(/^\s*\d+\t(.*)$/);
          return match ? match[1] : line;
        })
        .join("\n");

      if (!rawContent.includes(oldStr)) {
        throw new Error(
          `old_string not found in ${filePath}. Read the file first to see exact content.`
        );
      }

      if (!replaceAll) {
        const count = rawContent.split(oldStr).length - 1;
        if (count > 1) {
          throw new Error(
            `old_string found ${count} times in ${filePath}. ` +
              `Provide more context to make it unique, or use replace_all.`
          );
        }
      }

      const newContent = replaceAll
        ? rawContent.split(oldStr).join(newStr)
        : rawContent.replace(oldStr, newStr);

      await env.write_file(filePath, newContent);

      const replacements = replaceAll
        ? rawContent.split(oldStr).length - 1
        : 1;
      return `Edited ${filePath}: ${replacements} replacement(s) made`;
    },
  };
}

function makeShell(): RegisteredTool {
  return {
    definition: {
      name: "shell",
      description:
        "Execute a shell command. Returns stdout, stderr, and exit code.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          timeout_ms: {
            type: "integer",
            description: "Timeout in milliseconds (default 10000)",
          },
          description: {
            type: "string",
            description: "Description of what this command does",
          },
        },
        required: ["command"],
      },
    },
    executor: async (args, env) => {
      const command = args.command as string;
      const timeout = args.timeout_ms as number | undefined;
      const result = await env.exec_command(command, timeout);
      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += (output ? "\n" : "") + `STDERR: ${result.stderr}`;
      if (result.timed_out) output += "\n[TIMED OUT]";
      if (result.exit_code !== 0)
        output += `\n[Exit code: ${result.exit_code}]`;
      return output || "(no output)";
    },
  };
}

function makeGrep(): RegisteredTool {
  return {
    definition: {
      name: "grep",
      description:
        "Search file contents using regex patterns. Returns matching lines with file paths and line numbers.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regex pattern to search for" },
          path: {
            type: "string",
            description: "File or directory to search (default: working directory)",
          },
          glob_filter: {
            type: "string",
            description: 'Glob pattern to filter files (e.g. "*.ts")',
          },
          case_insensitive: { type: "boolean", description: "Case insensitive search" },
          max_results: {
            type: "integer",
            description: "Maximum number of results (default 100)",
          },
        },
        required: ["pattern"],
      },
    },
    executor: async (args, env) => {
      const pattern = args.pattern as string;
      const searchPath = (args.path as string) ?? ".";
      return env.grep(pattern, searchPath, {
        case_insensitive: args.case_insensitive as boolean,
        max_results: (args.max_results as number) ?? 100,
        glob_filter: args.glob_filter as string,
      });
    },
  };
}

function makeGlob(): RegisteredTool {
  return {
    definition: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns list of matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. *.ts)" },
          path: { type: "string", description: "Directory to search in" },
        },
        required: ["pattern"],
      },
    },
    executor: async (args, env) => {
      const pattern = args.pattern as string;
      const searchPath = args.path as string | undefined;
      const files = await env.glob(pattern, searchPath);
      return files.join("\n") || "(no matches)";
    },
  };
}

// ─── Registry Factory ───────────────────────────────────────────────────────

export function createCoreToolRegistry(): ToolRegistry {
  const { ToolRegistry } = require("./types.js") as typeof import("./types.js");
  const registry = new ToolRegistry();
  registry.register(makeReadFile());
  registry.register(makeWriteFile());
  registry.register(makeEditFile());
  registry.register(makeShell());
  registry.register(makeGrep());
  registry.register(makeGlob());
  return registry;
}

export function createCoreTools(): RegisteredTool[] {
  return [
    makeReadFile(),
    makeWriteFile(),
    makeEditFile(),
    makeShell(),
    makeGrep(),
    makeGlob(),
  ];
}
