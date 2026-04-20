import fs from "node:fs";
import path from "node:path";

export function envPath() {
  return path.resolve(process.cwd(), ".env");
}

export function readDotEnv(filePath = envPath()) {
  const values = {};
  if (!fs.existsSync(filePath)) {
    return values;
  }

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1);
    values[key] = value;
  }
  return values;
}

export function updateDotEnvValue(key, value, filePath = envPath()) {
  const lines = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8").split(/\r?\n/)
    : [];
  const nextLine = `${key}=${value}`;
  const existingIndex = lines.findIndex(line => line.startsWith(`${key}=`));
  if (existingIndex >= 0) {
    lines[existingIndex] = nextLine;
  } else {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push(nextLine);
  }
  fs.writeFileSync(filePath, `${lines.join("\n").replace(/\n*$/, "\n")}`);
}

export function readConfigValue(key, fallback = "") {
  const env = readDotEnv();
  return process.env[key] ?? env[key] ?? fallback;
}
