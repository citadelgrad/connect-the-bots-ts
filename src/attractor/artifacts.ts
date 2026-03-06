import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ArtifactInfo } from "./types.js";

const FILE_BACKING_THRESHOLD = 100 * 1024; // 100KB

export class ArtifactStore {
  private artifacts = new Map<string, { info: ArtifactInfo; data: unknown }>();
  private logsRoot: string;

  constructor(logsRoot: string) {
    this.logsRoot = logsRoot;
  }

  async store(
    artifactId: string,
    name: string,
    data: unknown
  ): Promise<ArtifactInfo> {
    const serialized = JSON.stringify(data);
    const size = Buffer.byteLength(serialized, "utf-8");
    const fileBacked = size > FILE_BACKING_THRESHOLD;

    const info: ArtifactInfo = {
      id: artifactId,
      name,
      size,
      file_backed: fileBacked,
    };

    if (fileBacked) {
      const dir = path.join(this.logsRoot, "artifacts");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, `${artifactId}.json`),
        serialized,
        "utf-8"
      );
      this.artifacts.set(artifactId, { info, data: null });
    } else {
      this.artifacts.set(artifactId, { info, data });
    }

    return info;
  }

  async retrieve(artifactId: string): Promise<unknown> {
    const entry = this.artifacts.get(artifactId);
    if (!entry) return undefined;

    if (entry.info.file_backed) {
      const filePath = path.join(
        this.logsRoot,
        "artifacts",
        `${artifactId}.json`
      );
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    }

    return entry.data;
  }

  list(): ArtifactInfo[] {
    return [...this.artifacts.values()].map((e) => e.info);
  }
}
