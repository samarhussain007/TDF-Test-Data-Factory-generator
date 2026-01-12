import { Command } from "commander";
import { introspectCmd } from "./commands/introspect.js";
import { generateCmd } from "./commands/generate.js";

const program = new Command();

program
  .name("tdf")
  .description("Test Data Factory - realistic relational seeding")
  .version("0.1.0");

program.addCommand(introspectCmd());
program.addCommand(generateCmd());

program.parse(process.argv);
