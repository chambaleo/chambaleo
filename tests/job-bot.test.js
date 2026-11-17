import test from "node:test";
import assert from "node:assert/strict";
import { getWorkMode, isHttpsUrl, isMexicoLocation } from "../scripts/job-bot/import.mjs";

test("Mexico eligibility accepts explicit Mexican locations and Mexico-scoped remote roles only", () => {
  assert.equal(isMexicoLocation("Ciudad de México · Remote"), true);
  assert.equal(isMexicoLocation("Remote - Mexico"), true);
  assert.equal(isMexicoLocation("Guadalajara, Jalisco"), true);
  assert.equal(isMexicoLocation("León, Spain"), false);
  assert.equal(isMexicoLocation("Remote - Latin America"), false);
  assert.equal(isMexicoLocation("Remote"), false);
});

test("external application links must be HTTPS and work mode comes from source text", () => {
  assert.equal(isHttpsUrl("https://jobs.example/apply/123"), true);
  assert.equal(isHttpsUrl("http://jobs.example/apply/123"), false);
  assert.equal(isHttpsUrl("https://user:pass@jobs.example/apply"), false);
  assert.equal(getWorkMode("Product Manager", "Remote - Mexico"), "Remoto");
  assert.equal(getWorkMode("Analista", "Querétaro · Hybrid"), "Híbrido");
});
