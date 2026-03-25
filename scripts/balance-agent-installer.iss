; Balance Agent Inno Setup installer
; Places the executable under Program Files, sets SERIAL_PATH system env var
; and optionally installs the exe as a service using nssm.exe if provided in the installer.
;
; To compile: install Inno Setup and run: ISCC.exe "scripts\balance-agent-installer.iss"

[Setup]
AppName=Balance Agent
AppVersion=1.0
DefaultDirName={pf64}\Balance Agent
DefaultGroupName=Balance Agent
OutputBaseFilename=balance-agent-installer
Compression=lzma
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin

[Files]
; The built executable is expected to be in the repo 'scripts' folder.
; Use a relative path so that compiling with ISCC from the repository root works reliably.
; If you instead compile from the scripts folder, both forms will work, but using the
; relative path below avoids compiler {src} expansion issues.
Source: "scripts\balance-agent.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Balance Agent"; Filename: "{app}\balance-agent.exe"
Name: "{group}\Uninstall Balance Agent"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\balance-agent.exe"; Description: "Run Balance Agent"; Flags: nowait postinstall skipifsilent

[Code]
const
  WM_SETTINGCHANGE = $1A;
  HWND_BROADCAST = $FFFF;

function SendMessageTimeout(hWnd: Integer; Msg: Cardinal; wParam: Integer; lParam: string; Flags: Cardinal; Timeout: Cardinal; var Result: Cardinal): Integer;
  external 'SendMessageTimeoutA@user32.dll stdcall';

procedure BroadcastEnvironmentChange();
var
  Res: Cardinal;
begin
  SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, 0, 'Environment', 0, 5000, Res);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PortVal: string;
  InstallSvc: Integer;
  ResultCode: Integer;
  NSSMPath: string;
begin
  if CurStep = ssInstall then
  begin
    // Ask for serial port
    if InputQuery('Configuration série', 'Indiquez le port série (ex: COM3) :', PortVal) then
    begin
      if Trim(PortVal) <> '' then
      begin
        // Write environment variable to HKLM so it's system-wide
        RegWriteStringValue(HKLM, 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment', 'SERIAL_PATH', Trim(PortVal));
        BroadcastEnvironmentChange();
      end;
    end;

    // Ask whether to install as a service using nssm (if available)
    InstallSvc := MsgBox('Voulez-vous installer le Balance Agent comme service Windows (NSSM requis) ?', mbConfirmation, MB_YESNO);
    if InstallSvc = IDYES then
    begin
      NSSMPath := ExpandConstant('{app}\nssm.exe');
      if FileExists(NSSMPath) then
      begin
        Exec(NSSMPath, 'install "BalanceAgent" "' + ExpandConstant('{app}\balance-agent.exe') + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        if ResultCode <> 0 then
          MsgBox('Installation du service via NSSM échouée (code: ' + IntToStr(ResultCode) + ')', mbError, MB_OK)
        else
          MsgBox('Service installé (BalanceAgent) via NSSM.', mbInformation, MB_OK);
      end else
      begin
        MsgBox('nssm.exe introuvable dans le dossier d''installation. Copiez nssm.exe si vous souhaitez installer en service.', mbInformation, MB_OK);
      end;
    end;
  end;
end;
