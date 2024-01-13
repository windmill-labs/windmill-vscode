import * as vscode from "vscode";

export function executeCommand(command: string, args: string): String {
  const cp = require("child_process");

  let argument: string = args;
  let operation: string = command + " " + argument;
  let cmd = "abcd" + operation;

  const proc = cp.spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
  });

  let procData = proc.stdout.toString();

  if (proc !== null) {
    if (proc.stdout !== null && proc.stdout.toString() !== "") {
      procData = proc.stdout.toString();
    }
    if (proc.stderr !== null && proc.stderr.toString() !== "") {
      const procErr = proc.stderr.toString;
      vscode.window.showErrorMessage(
        "The '" + operation + "' process failed: " + procErr
      );
      procData = procErr;
    }
  }

  vscode.window.showInformationMessage(
    "The '" + operation + "' process done:" + procData
  );

  return procData;
}
