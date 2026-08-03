import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './map-derivatives-lib.mjs';

function checkedPath(root, relative) {
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Pinned tool path escaped its local root: ${relative}`);
  }
  return resolved;
}

function verifyFile(file, expectedSha256, label) {
  if (!fs.existsSync(file)) throw new Error(`Pinned ${label} is missing: ${file}`);
  const actualSha256 = sha256(fs.readFileSync(file));
  if (actualSha256 !== expectedSha256) {
    throw new Error(`Pinned ${label} checksum mismatch: expected ${expectedSha256}, received ${actualSha256}`);
  }
}

function versionOf(command) {
  const result = childProcess.spawnSync(command, ['--version'], {
    encoding: 'utf8',
    env: { ...process.env, TOKTX_OPTIONS: '' },
  });
  if (result.status !== 0) throw new Error(`Pinned command failed its version probe: ${command}`);
  return `${result.stdout}${result.stderr}`.trim();
}

/** Resolve and authenticate the workspace-local derivative toolchain. Ambient PATH tools are never accepted. */
export function inspectPinnedToolchain(repository, toolchain, platform = `${process.platform}-${process.arch}`) {
  const toolsRoot = path.join(repository, '.tools', 'map-derivatives');
  const platformConfig = toolchain.ktxSoftware?.platforms?.[platform];
  if (!platformConfig) throw new Error(`No pinned KTX-Software artifact is declared for ${platform}`);
  const installRoot = checkedPath(toolsRoot, platformConfig.installDirectory);
  const commands = {};
  for (const [name, expectedSha256] of Object.entries(platformConfig.executables ?? {})) {
    const command = checkedPath(installRoot, path.join('bin', name));
    verifyFile(command, expectedSha256, `${name} executable`);
    commands[name] = command;
  }
  for (const [relative, expectedSha256] of Object.entries(platformConfig.libraries ?? {})) {
    verifyFile(checkedPath(installRoot, relative), expectedSha256, relative);
  }
  if (!commands.ktx || !commands.toktx || !commands.ktxinfo) {
    throw new Error('Pinned KTX-Software declaration must include ktx, toktx, and ktxinfo');
  }
  const ktxVersion = versionOf(commands.ktx);
  const toktxVersion = versionOf(commands.toktx);
  if (ktxVersion !== `ktx version: v${toolchain.ktxSoftware.version}`) {
    throw new Error(`Pinned ktx version mismatch: ${ktxVersion}`);
  }
  if (toktxVersion !== `toktx v${toolchain.ktxSoftware.version}`) {
    throw new Error(`Pinned toktx version mismatch: ${toktxVersion}`);
  }
  return { platform, toolsRoot, installRoot, commands, ktxVersion, toktxVersion };
}

export function pinnedToolEnvironment(inspected) {
  return {
    ...process.env,
    PATH: `${path.dirname(inspected.commands.ktx)}${path.delimiter}${process.env.PATH ?? ''}`,
    // Prevent caller-specific options from silently changing derivative output.
    TOKTX_OPTIONS: '',
  };
}
