import { ask } from '../lib/prompt.mjs';
import { doctor } from './doctor.mjs';
import { detect } from './detect.mjs';
import { build, showBuildHistory } from './build.mjs';
import { aiDoctor, aiSetup } from './ai.mjs';
import { aiStudio } from '../ai/studio.mjs';
import { gitCommand } from './git.mjs';
import { taskCommand } from './tasks.mjs';
import { doctorProfileCommand, doctorInspectCommand, doctorLabCommand } from './doctor-intelligence.mjs';

export async function devMenu() {
  if (!process.stdin.isTTY) throw new Error('Interactive mode requires a terminal. Run paxi help for non-interactive commands.');
  console.log('\n╭────────────────────────────────────╮');
  console.log('│            PAXI DevKit             │');
  console.log('│  Local-first developer terminal    │');
  console.log('╰────────────────────────────────────╯');
  console.log('1. Check environment');
  console.log('2. Detect current project');
  console.log('3. Build Android debug APK');
  console.log('4. Build Android release AAB');
  console.log('5. Build iOS release IPA (Mac + Xcode required)');
  if (process.platform === 'win32') console.log('13. Build Windows release ZIP (Visual Studio C++ required)');
  console.log('6. Check AI mode');
  console.log('7. Configure AI mode');
  console.log('8. Git status');
  console.log('9. Show build history');
  console.log('10. Run project tests');
  console.log('11. Install latest successful APK');
  console.log('12. List Android devices');
  console.log('14. Inspect current project with PAXI Doctor');
  console.log('15. View developer preferences');
  console.log('16. View Device Lab profiles');
  console.log('17. Open PAXI AI Studio');
  console.log('0. Exit');
  const choice = await ask('\nSelect an action: ');
  switch (choice) {
    case '1': return doctor();
    case '2': return detect(process.cwd());
    case '3': return build({ platform: 'android', format: 'apk', variant: 'debug' });
    case '4': return build({ platform: 'android', format: 'aab', variant: 'release' });
    case '5': return build({ platform: 'ios', format: 'ipa', variant: 'release' });
    case '13': return build({ platform: 'windows', format: 'zip', variant: 'release' });
    case '6': return aiDoctor();
    case '7': return aiSetup();
    case '8': return gitCommand(['status']);
    case '9': return showBuildHistory();
    case '10': return taskCommand('test');
    case '11': return taskCommand('install');
    case '12': return taskCommand('devices');
    case '14': return doctorInspectCommand([]);
    case '15': return doctorProfileCommand(['show']);
    case '16': return doctorLabCommand(['profiles']);
    case '17': return aiStudio();
    case '0': return;
    default: throw new Error('Unknown menu selection. Run paxi dev to try again.');
  }
}
