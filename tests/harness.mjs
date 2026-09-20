// Tiny zero-dependency test harness (node tools/… runs these directly)
let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = "";

export function suite(name) {
  currentSuite = name;
  console.log(`\n── ${name} ──`);
}

export function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(
        () => {
          passed++;
          console.log(`  ✓ ${name}`);
        },
        (err) => {
          failed++;
          failures.push(`${currentSuite} › ${name}: ${err.message}`);
          console.log(`  ✗ ${name}\n      ${err.message}`);
        }
      );
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push(`${currentSuite} › ${name}: ${err.message}`);
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
  return Promise.resolve();
}

export function assert(cond, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}

export function assertEq(actual, expected, msg = "") {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + " — " : ""}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertIncludes(haystack, needle, msg = "") {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${msg ? msg + " — " : ""}expected to include ${JSON.stringify(needle)}`);
  }
}

export function assertNotIncludes(haystack, needle, msg = "") {
  if (String(haystack).includes(needle)) {
    throw new Error(`${msg ? msg + " — " : ""}expected NOT to include ${JSON.stringify(needle)}`);
  }
}

export async function summarize(label = "Tests") {
  console.log(`\n${"═".repeat(46)}`);
  console.log(`${label}: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  • ${f}`));
  }
  console.log("═".repeat(46));
  process.exit(failed ? 1 : 0);
}

export const results = () => ({ passed, failed });
