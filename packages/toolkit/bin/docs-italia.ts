#!/usr/bin/env node
/**
 * docs-italia — CLI del toolkit. Ossatura: i comandi arriveranno dal PoC.
 */
const COMMANDS = ['init', 'check', 'build', 'dev', 'studio', 'publish', 'mcp'];
const [cmd] = process.argv.slice(2);
if (!cmd || cmd === 'help' || cmd === '--help') {
  console.log(`docs-italia <comando>\n\nComandi previsti: ${COMMANDS.join(', ')}\n(ossatura: nessun comando è ancora implementato)`);
} else {
  console.error(`"${cmd}": non ancora implementato in questa ossatura.`);
  process.exitCode = 1;
}
