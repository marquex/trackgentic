#!/usr/bin/env bun
import { createProgram } from "./cli/runner";

const program = createProgram();
program.parse();
