const { execFileSync } = require('node:child_process');
const path = require('node:path');

const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

function runPlistBuddy(plistPath, commands, options = {}) {
  const args = commands.flatMap((command) => ['-c', command]);
  args.push(plistPath);

  try {
    execFileSync(PLIST_BUDDY, args, { stdio: 'pipe' });
    return true;
  } catch (error) {
    if (options.allowFailure) {
      return false;
    }

    const stderr = error.stderr?.toString().trim();
    const message = stderr || error.message;
    throw new Error(`Failed to patch macOS Info.plist: ${message}`);
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const plistPath = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist');

  runPlistBuddy(plistPath, ['Add :NSAppTransportSecurity dict'], { allowFailure: true });
  runPlistBuddy(plistPath, ['Delete :NSAppTransportSecurity:NSAllowsArbitraryLoads'], {
    allowFailure: true,
  });
  runPlistBuddy(plistPath, ['Delete :NSAppTransportSecurity:NSAllowsLocalNetworking'], {
    allowFailure: true,
  });

  runPlistBuddy(plistPath, [
    'Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool false',
    'Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true',
  ]);
};
