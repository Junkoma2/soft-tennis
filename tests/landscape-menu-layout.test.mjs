// 横画面のメニュー画面(#screen-ready)レイアウト調整の回帰テスト。
// style.cssはビルドを持たない静的ファイルなので、DOM実行ではなくテキストとして
// 読み込み、意図した規則（2列折り返し・#appの横幅拡張）が残っているかを確認する。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, "../style.css"), "utf8");

function landscapeBlocks(source) {
  const blocks = [];
  const marker = "@media (orientation: landscape)";
  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let end = braceStart;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    blocks.push(source.slice(start, end + 1));
    from = end + 1;
  }
  return blocks;
}

test("横画面メニュー: #screen-readyを2列に折り返す規則が存在する", () => {
  const blocks = landscapeBlocks(css);
  const menuBlock = blocks.find((b) => b.includes("#screen-ready") && b.includes("column-count"));
  assert.ok(menuBlock, "#screen-readyをcolumn-countで折り返す横画面用の規則が見つからない");
  assert.match(menuBlock, /#screen-ready\s*\{[^}]*column-count:\s*2/);
  assert.match(menuBlock, /break-inside:\s*avoid/);
});

test("横画面メニュー: #appの横幅が縦画面時の480pxより広く拡張される", () => {
  const blocks = landscapeBlocks(css);
  const menuBlock = blocks.find((b) => b.includes("#screen-ready") && b.includes("column-count"));
  assert.ok(menuBlock, "横画面メニュー用ブロックが見つからない");
  const widthMatch = menuBlock.match(/body:has\(#screen-ready:not\(\[hidden\]\)\)\s*#app\s*\{[^}]*max-width:\s*(\d+)px/);
  assert.ok(widthMatch, "#screen-readyの#app向けmax-width指定が見つからない");
  assert.ok(Number(widthMatch[1]) > 480, "横画面でも縦画面と同じ480px制限のままになっている");
});

test("縦画面には影響しない: #screen-readyの基本規則(.screen)はflex/column構成のまま", () => {
  // #screen-readyの2列化は@media (orientation: landscape)内に閉じており、
  // ベースの.screenルール（縦画面で使われるflex-directionレイアウト）が
  // そのまま残っていることを確認する。
  assert.match(css, /\.screen\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
});
