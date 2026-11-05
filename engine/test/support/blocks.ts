// The block files and measurement profiles shared by the engine tests (not part of the engine's
// API). The engine has no block registry, so the tests read engine/blocks/ with fs.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** engine/blocks/, one version 1 pattern definition per block. */
export const BLOCKS_DIR = join(import.meta.dir, "..", "..", "blocks");

/** The block file names (`<key>.json`), sorted. */
export function blockFiles(): string[] {
  return readdirSync(BLOCKS_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort();
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** The definition of block `name` (its file name without `.json`), parsed but not validated. */
export function readBlock(name: string): unknown {
  return readJson(join(BLOCKS_DIR, `${name}.json`));
}

/** Small, medium and large bodies for the skirt and bodice (no arm measurements). */
// prettier-ignore
export const PROFILES: Readonly<Record<"small" | "medium" | "large", Record<string, number>>> = {
  small: {
    bust: 820, waist: 640, hip: 880, neck: 350, shoulder_width: 118, back_width: 330,
    chest_width: 310, back_length: 400, armhole_depth: 200, front_length: 430, bust_height: 255,
    bust_distance: 180, hip_height: 200, skirt_length: 550,
  },
  medium: {
    bust: 880, waist: 680, hip: 940, neck: 370, shoulder_width: 122, back_width: 344,
    chest_width: 324, back_length: 410, armhole_depth: 210, front_length: 445, bust_height: 265,
    bust_distance: 190, hip_height: 206, skirt_length: 600,
  },
  large: {
    bust: 1080, waist: 900, hip: 1140, neck: 410, shoulder_width: 130, back_width: 390,
    chest_width: 370, back_length: 430, armhole_depth: 235, front_length: 490, bust_height: 300,
    bust_distance: 220, hip_height: 220, skirt_length: 700,
  },
};

/** The sleeve's arm measurements, the same for every profile. */
export const ARM_MEASUREMENTS: Readonly<Record<string, number>> = {
  arm_length: 580,
  upper_arm: 280,
  wrist: 160,
};

/** The medium profile with the arm measurements: enough for every block. */
export const MEDIUM: Readonly<Record<string, number>> = { ...PROFILES.medium, ...ARM_MEASUREMENTS };
