#!/usr/bin/env node
import { Command } from "commander";
import { runInit } from "./init.js";
import { runDoctor, printDoctorReport } from "./doctor.js";
import { runSync } from "./sync.js";
import { runSearch } from "./search.js";
import { runMessages } from "./messages.js";

const program = new Command();
program
  .name("slackclaw")
  .description(
    "Slack DMs and saved-items scraper. Local archive of your Slack messages claw-able for agents.",
  );

program.command("init").action(runInit);

program
  .command("doctor")
  .option("--json", "output JSON")
  .action((opts) => printDoctorReport(runDoctor(), Boolean(opts.json)));

program
  .command("sync")
  .option("--source <source>", "cache|self|bot|all", "cache")
  .option("--full", "ignore incremental cursor")
  .action((opts) => runSync(opts));

program.command("search <query>").action((query) => runSearch(query));

program
  .command("messages")
  .requiredOption("--channel <name>")
  .option("--hours <n>", "look back N hours", "24")
  .action((opts) => runMessages(opts));

program.parseAsync(process.argv);
