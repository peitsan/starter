#!/usr/bin/env node
// starter CLI entry
import { Command } from 'commander';
import { registerCommands } from './commands.js';

const program = new Command();
program
  .name('starter')
  .description('Starter — modern Windows startup manager')
  .version('0.0.0')
  .option('--json', 'output JSON (machine-readable)')
  .option('--no-color', 'disable ANSI colors');

registerCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
