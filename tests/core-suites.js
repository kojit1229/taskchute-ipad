"use strict";

const fs = require("fs");
const path = require("path");

const RECENT_COUNT = 5;
const FIXED_CORE = ["v72", "v59", "v67", "v50", "v70"];

function getCoreSuites(directory = __dirname) {
  const recent = fs.readdirSync(directory)
    .filter((file) => /^v\d+\.test\.js$/.test(file))
    .map((file) => ({ file, version: Number(file.match(/^v(\d+)/)[1]) }))
    .sort((a, b) => b.version - a.version)
    .slice(0, RECENT_COUNT)
    .map(({ file }) => path.basename(file, ".test.js"));
  return [...new Set([...recent, ...FIXED_CORE])];
}

module.exports = { FIXED_CORE, RECENT_COUNT, getCoreSuites };
