// 组件挂载冒烟：node scripts/ui-smoke.mjs
import { build } from "esbuild";
import { writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const source = `
import React from "react";
import { renderToString } from "react-dom/server";
import App from "./src/App";

// localStorage 兜底
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
};

const html = renderToString(React.createElement(App));
const must = ["出土物总台账", "现场装箱登记", "库房入库", "保管员裁决台", "双账稽核", "TC-001"];
const miss = must.filter((m) => !html.includes(m));
if (miss.length) {
  console.error("渲染缺少关键内容:", miss.join(", "));
  process.exit(1);
}
console.log("App SSR 渲染通过，包含全部关键区块，HTML 长度", html.length);
`;

const outfile = fileURLToPath(new URL("./.ui-smoke-bundle.cjs", import.meta.url));
try {
  const result = await build({
    stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, format: "cjs", platform: "node", write: false,
    jsx: "automatic",
    loader: { ".css": "empty" },
  });
  writeFileSync(outfile, result.outputFiles[0].text);
  execFileSync(process.execPath, [outfile], { stdio: "inherit" });
} finally {
  try { rmSync(outfile); } catch {}
}
