import { scanTaskScheduler } from '../src/scanner/schtasks.js';

async function main(): Promise<void> {
  const items = await scanTaskScheduler();
  console.log('count:', items.length);
  const enabled = items.filter((i) => i.enabled);
  console.log('enabled:', enabled.length);
  for (const i of items.slice(0, 25)) {
    console.log(
      `${i.enabled ? '[ON]' : '[OFF]'} ${i.source} | ${i.name} | ${i.risk} | ${(i.command || '(no cmd)').slice(0, 70)}`,
    );
  }
}
void main();
