#!/usr/bin/env node
// starter CLI — placeholder; real commands land in subsequent PRs.
import { Command } from 'commander';

const program = new Command();
program
  .name('starter')
  .description('Starter — Windows startup manager (CLI)')
  .version('0.0.0');

program
  .command('hello')
  .description('smoke test command')
  .option('--name <name>', 'who to greet', 'world')
  .action((opts: { name: string }) => {
    console.info(`hello, ${opts.name}!`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
