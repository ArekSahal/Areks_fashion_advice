// Pins dependency versions to the ones the installed Expo SDK expects, using
// node_modules/expo/bundledNativeModules.json. Used by the "Bootstrap dependencies" workflow.
// Usage: node scripts/resolve-deps.mjs "<deps>" "<devDeps>"
// Packages not in the SDK list get "latest" (resolved by the following npm install).
import { readFileSync, writeFileSync } from 'node:fs';

// After `npm install`, run with --pin to turn any "latest" into "^<installed version>".
if (process.argv[2] === '--pin') {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (range !== 'latest') continue;
      const installed = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8')).version;
      pkg[field][name] = `^${installed}`;
      console.log(`pinned ${name}@^${installed}`);
    }
  }
  writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  process.exit(0);
}

const [deps = '', devDeps = ''] = process.argv.slice(2);
const bundled = JSON.parse(readFileSync('node_modules/expo/bundledNativeModules.json', 'utf8'));
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const reactVersion = bundled.react?.replace(/^[~^]/, '');

function versionFor(name) {
  if (bundled[name]) return bundled[name];
  if (name === '@types/react' && reactVersion) return `~${reactVersion.split('.').slice(0, 2).join('.')}.0`;
  return 'latest';
}

for (const [field, list] of [['dependencies', deps], ['devDependencies', devDeps]]) {
  pkg[field] ??= {};
  for (const name of list.split(/\s+/).filter(Boolean)) {
    pkg[field][name] = versionFor(name);
    console.log(`${field}: ${name}@${pkg[field][name]}`);
  }
}

writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
