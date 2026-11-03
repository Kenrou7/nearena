import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  output: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string }
) => Promise<CommandResult>;

export const defaultCommandRunner: CommandRunner = (command, args, options) =>
  new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        output: [stdout, stderr].filter((part) => part.length > 0).join("\n")
      });
    });
  });

export async function runOrThrow(
  run: CommandRunner,
  command: string,
  args: string[],
  options?: { cwd?: string }
): Promise<string> {
  const result = await run(command, args, options);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}\n${result.output}`);
  }

  return result.output;
}
