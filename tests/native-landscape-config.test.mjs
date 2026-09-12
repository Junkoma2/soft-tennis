import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Capacitorはローカル生成物をネイティブアプリへ組み込む", async () => {
  const config = JSON.parse(await readFile(path.join(projectRoot, "capacitor.config.json"), "utf8"));

  assert.equal(config.appId, "com.nonsensicalnook.softtennis");
  assert.equal(config.appName, "ソフトテニス");
  assert.equal(config.webDir, "mobile-dist");
  assert.equal(config.server?.url, undefined, "公開URLをWebViewへ直接読み込まない");
});

test("Androidは回転ロック中も横向き左右だけを使う", async () => {
  const manifest = await readFile(
    path.join(projectRoot, "android", "app", "src", "main", "AndroidManifest.xml"),
    "utf8",
  );

  assert.match(manifest, /android:screenOrientation="sensorLandscape"/);
  assert.match(manifest, /android:name="android\.hardware\.screen\.landscape"/);
  assert.match(manifest, /android:required="true"/);
  assert.doesNotMatch(manifest, /android:screenOrientation="portrait"/);
});

test("iPhoneとiPadは横向きだけを許可する", async () => {
  const infoPlist = await readFile(path.join(projectRoot, "ios", "App", "App", "Info.plist"), "utf8");

  assert.match(infoPlist, /<key>UIRequiresFullScreen<\/key>\s*<true\/>/);
  assert.match(infoPlist, /<string>UIInterfaceOrientationLandscapeLeft<\/string>/);
  assert.match(infoPlist, /<string>UIInterfaceOrientationLandscapeRight<\/string>/);
  assert.doesNotMatch(infoPlist, /UIInterfaceOrientationPortrait/);
});
