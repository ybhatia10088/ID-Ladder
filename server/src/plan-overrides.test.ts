import assert from "node:assert/strict";
import { test } from "node:test";

import { overridesFrom } from "./plan-overrides.js";

test("no query parameters means no overrides at all", () => {
  assert.deepEqual(overridesFrom({}), {});
});

test("jurisdictions are normalised to upper case", () => {
  assert.deepEqual(overridesFrom({ born_in: "mi", living_in: "ca" }), {
    birth_jurisdiction: "MI",
    current_jurisdiction: "CA",
  });
});

test("standing is parsed as a comma-separated list", () => {
  assert.deepEqual(overridesFrom({ standing: "ca,mi" }).standing, ["CA", "MI"]);
  assert.deepEqual(overridesFrom({ standing: "CA, MI , wa" }).standing, ["CA", "MI", "WA"]);
});

test("an empty list is an instruction, not an absent parameter", () => {
  // Unticking every checkbox must mean "holds nothing" / "vouches nowhere",
  // not "fall back to the stored values".
  assert.deepEqual(overridesFrom({ holds: "" }).holdings, []);
  assert.deepEqual(overridesFrom({ standing: "" }).standing, []);

  // Whereas omitting them entirely leaves the stored values alone.
  assert.equal(overridesFrom({}).holdings, undefined);
  assert.equal(overridesFrom({}).standing, undefined);
});

test("holdings keep their document ids verbatim", () => {
  assert.deepEqual(overridesFrom({ holds: "ca-birth-certificate-state,us-ssn-card" }).holdings, [
    "ca-birth-certificate-state",
    "us-ssn-card",
  ]);
});

test("the goal is passed through untouched", () => {
  assert.equal(overridesFrom({ goal: "mi-id-card" }).goal_document_id, "mi-id-card");
});

test("junk and empty strings are ignored rather than overriding with nothing", () => {
  assert.deepEqual(overridesFrom({ born_in: "", goal: "", living_in: undefined }), {});
  assert.deepEqual(overridesFrom({ born_in: ["CA"] as unknown as string }), {});
});
