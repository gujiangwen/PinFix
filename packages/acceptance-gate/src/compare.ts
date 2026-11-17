import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export type CompareResult = {
  passed: boolean;
  diffRatio: number;
  baselineCreated: boolean;
  diffPath?: string;
};

export function comparePng(
  actualPath: string,
  baselinePath: string,
  diffPath: string,
  maxDiffPixelRatio: number,
): CompareResult {
  if (!existsSync(baselinePath)) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, readFileSync(actualPath));
    return { passed: true, diffRatio: 0, baselineCreated: true };
  }

  const img1 = PNG.sync.read(readFileSync(baselinePath));
  const img2 = PNG.sync.read(readFileSync(actualPath));
  if (img1.width !== img2.width || img1.height !== img2.height) {
    mkdirSync(dirname(diffPath), { recursive: true });
    writeFileSync(diffPath, PNG.sync.write(img2));
    return {
      passed: false,
      diffRatio: 1,
      baselineCreated: false,
      diffPath,
    };
  }

  const { width, height } = img1;
  const diff = new PNG({ width, height });
  const mismatched = pixelmatch(
    img1.data,
    img2.data,
    diff.data,
    width,
    height,
    { threshold: 0.1 },
  );
  const total = width * height || 1;
  const diffRatio = mismatched / total;
  mkdirSync(dirname(diffPath), { recursive: true });
  writeFileSync(diffPath, PNG.sync.write(diff));

  return {
    passed: diffRatio <= maxDiffPixelRatio,
    diffRatio,
    baselineCreated: false,
    diffPath,
  };
}

export function baselinePngPath(
  baselinesRoot: string,
  projectId: string,
  fingerprint: string,
  name: string,
): string {
  return join(baselinesRoot, projectId, fingerprint, `${name}.png`);
}
