"use strict";

require("@babel/register")({
  extensions: [".js"],
  ignore: [/node_modules/],
});

const assert = require("assert");
const {
  SPH_LOCATION_MODES,
} = require("../src/shared/accountPublishSettings");
const {
  applySphLocationMode,
} = require("../src/main/services/upLoad/sphLocation");

function createMockPage(initialLocation = "随州市") {
  const calls = [];
  let currentLocation = initialLocation;
  let menuOpen = false;
  let evaluateCount = 0;
  const display = {
    async click() {
      calls.push("open");
      menuOpen = true;
    },
  };
  const nameHandle = {
    async evaluate() {
      return currentLocation;
    },
  };
  const noneOption = {
    async evaluate() {
      return "不显示位置";
    },
    async click() {
      calls.push("select-none");
      currentLocation = "不显示位置";
    },
  };

  return {
    calls,
    async waitForSelector() {
      return display;
    },
    async $(selector) {
      return selector.includes(".location-name") ? nameHandle : null;
    },
    async $$() {
      return [noneOption];
    },
    async waitForTimeout() {},
    async evaluate() {
      evaluateCount += 1;
      if (evaluateCount === 1) return menuOpen;
      if (evaluateCount === 2) {
        calls.push("select-none");
        currentLocation = "不显示位置";
        return { ok: true, optionCount: 20 };
      }
      return {
        ready: true,
        menuVisible: false,
        placeVisible: false,
        hasLocationName: false,
        locationName: "",
      };
    },
  };
}

(async () => {
  const defaultPage = createMockPage();
  assert.deepStrictEqual(
    await applySphLocationMode(
      defaultPage,
      SPH_LOCATION_MODES.PLATFORM_DEFAULT
    ),
    { mode: SPH_LOCATION_MODES.PLATFORM_DEFAULT, changed: false }
  );
  assert.deepStrictEqual(defaultPage.calls, []);

  const nonePage = createMockPage();
  assert.deepStrictEqual(
    await applySphLocationMode(nonePage, SPH_LOCATION_MODES.NONE),
    { mode: SPH_LOCATION_MODES.NONE, changed: true }
  );
  assert.deepStrictEqual(nonePage.calls, ["open", "select-none"]);

  const alreadyNonePage = createMockPage("不显示位置");
  assert.deepStrictEqual(
    await applySphLocationMode(alreadyNonePage, SPH_LOCATION_MODES.NONE),
    { mode: SPH_LOCATION_MODES.NONE, changed: false }
  );
  assert.deepStrictEqual(alreadyNonePage.calls, []);

  console.log("test-sph-location passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
