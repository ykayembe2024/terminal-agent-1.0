Balance Agent — Inno Setup installer helper

This folder contains `balance-agent-installer.iss`, an Inno Setup script to produce a Windows installer.

How it works
- The installer copies `balance-agent.exe` into "Program Files\Balance Agent".
- During install it prompts for the serial port (e.g. COM3) and writes it as a SYSTEM environment variable `SERIAL_PATH`.
- Optionally it can install the application as a Windows service using `nssm.exe` if you include `nssm.exe` in the installer (place it next to `balance-agent.exe` before compiling).

Steps to create the installer
1) Ensure you have the final executable `balance-agent.exe` in the `scripts/` folder (next to the .iss file).
  The Inno script now references `scripts\balance-agent.exe` so compile it from the repository root
  (recommended) or adjust the `Source:` path if your layout differs.
2) Install Inno Setup Compiler (https://jrsoftware.org/isinfo.php)
3) Compile the script (from the repository root so the relative path resolves):

  ISCC.exe "scripts\balance-agent-installer.iss"

4) The resulting file `balance-agent-installer.exe` will be generated in the script output folder.

Notes and options
- The script writes the environment variable to the registry key:
  HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\SERIAL_PATH
  and broadcasts a WM_SETTINGCHANGE so new processes pick it up.
- If you prefer to use `setx` instead, modify the [Code] Pascal section to call `Exec('setx', ...)`.
- The installer requires administrative privileges to write system environment variables and to install a service.

If you want, I can:
- Update the script to also drop a default `config.js` or allow the user to edit config values at install time.
- Add a simple check to validate the serial port format (COM\d+) before writing it.
- Remove the NSSM flow entirely if you want a simple installer without service support.
