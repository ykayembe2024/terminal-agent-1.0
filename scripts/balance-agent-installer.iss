; Balance Agent Inno Setup installer
; Compile depuis la racine du repo :
;   "C:\Users\...\Inno Setup 6\ISCC.exe" "scripts\balance-agent-installer.iss"

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
OutputDir=..\dist
WizardStyle=modern
CloseApplications=force
RestartApplications=no

[Dirs]
Name: "{app}\logs"
Name: "{app}\storage"

[Files]
Source: "nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "balance-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\config.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\core\*"; DestDir: "{app}\core"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\serial\*"; DestDir: "{app}\serial"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\storage\*"; DestDir: "{app}\storage"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Balance Agent"; Filename: "{app}\balance-agent.exe"; WorkingDir: "{app}"
Name: "{group}\Uninstall Balance Agent"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\sc.exe"; Parameters: "start BalanceAgent"; StatusMsg: "Démarrage du service BalanceAgent..."; Flags: runhidden waituntilterminated

[UninstallRun]
Filename: "{app}\nssm.exe"; Parameters: "stop BalanceAgent"; RunOnceId: "StopBalanceAgent"; Flags: runhidden waituntilterminated
Filename: "{app}\nssm.exe"; Parameters: "remove BalanceAgent confirm"; RunOnceId: "RemoveBalanceAgent"; Flags: runhidden waituntilterminated

[Code]
var
  SerialPage: TInputQueryWizardPage;

const
  WM_SETTINGCHANGE = $1A;

function SendMessageTimeout(hWnd: Integer; Msg: Cardinal; wParam: Integer;
  lParam: string; Flags: Cardinal; Timeout: Cardinal;
  var OutRes: Cardinal): Integer;
  external 'SendMessageTimeoutA@user32.dll stdcall';

procedure BroadcastEnvironmentChange();
var
  ResCode: Cardinal;
begin
  SendMessageTimeout(HWND_BROADCAST, WM_SETTINGCHANGE, 0, 'Environment', 0, 5000, ResCode);
end;

procedure InitializeWizard();
begin
  SerialPage := CreateInputQueryPage(
    wpSelectDir,
    'Configuration du port série',
    'Indiquez le port série utilisé par Balance Agent',
    'Exemple : COM3'
  );

  SerialPage.Add('Port série :', False);
  SerialPage.Values[0] := ExpandConstant('{param:SerialPort|COM3}');
end;

function GetSerialPort(): string;
var
  PortVal: string;
begin
  PortVal := Trim(SerialPage.Values[0]);
  if PortVal = '' then
    PortVal := ExpandConstant('{param:SerialPort|COM3}');
  if PortVal = '' then
    PortVal := 'COM3';
  Result := PortVal;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PortVal: string;
  InstallSvc: Boolean;
  ResultCode: Integer;
  NSSMPath: string;
  ExePath: string;
  AppDir: string;
begin
  if CurStep = ssInstall then
  begin
    AppDir := ExpandConstant('{app}');
    NSSMPath := AppDir + '\nssm.exe';
    if FileExists(NSSMPath) then
    begin
      Exec(NSSMPath, 'stop BalanceAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
      Sleep(1500);
    end;
    Exec(ExpandConstant('{sys}\sc.exe'), 'stop BalanceAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Sleep(1000);
  end;

  if CurStep = ssPostInstall then
  begin
    AppDir := ExpandConstant('{app}');
    ExePath := AppDir + '\balance-agent.exe';
    NSSMPath := AppDir + '\nssm.exe';
    PortVal := GetSerialPort();

    RegWriteStringValue(
      HKLM,
      'SYSTEM\CurrentControlSet\Control\Session Manager\Environment',
      'SERIAL_PATH',
      PortVal
    );
    BroadcastEnvironmentChange();

    { En silent : toujours installer le service. En UI : demander. }
    if WizardSilent then
      InstallSvc := True
    else
      InstallSvc := MsgBox(
        'Voulez-vous installer Balance Agent comme service Windows ?',
        mbConfirmation, MB_YESNO
      ) = IDYES;

    if InstallSvc then
    begin
      if not FileExists(NSSMPath) then
      begin
        if not WizardSilent then
          MsgBox('nssm.exe est introuvable dans le dossier d''installation.', mbError, MB_OK);
      end
      else if not FileExists(ExePath) then
      begin
        if not WizardSilent then
          MsgBox('balance-agent.exe est introuvable dans le dossier d''installation.', mbError, MB_OK);
      end
      else
      begin
        Exec(NSSMPath, 'stop BalanceAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        Exec(NSSMPath, 'remove BalanceAgent confirm', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);

        Exec(
          NSSMPath,
          'install BalanceAgent "' + ExePath + '"',
          '',
          SW_HIDE,
          ewWaitUntilTerminated,
          ResultCode
        );

        if ResultCode <> 0 then
        begin
          if not WizardSilent then
            MsgBox('Échec de l''installation du service NSSM (code: ' + IntToStr(ResultCode) + ')', mbError, MB_OK);
        end
        else
        begin
          Exec(NSSMPath, 'set BalanceAgent AppDirectory "' + AppDir + '"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent AppEnvironmentExtra SERIAL_PATH=' + PortVal, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent Start SERVICE_AUTO_START', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent AppStdout "' + AppDir + '\logs\service-stdout.log"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent AppStderr "' + AppDir + '\logs\service-stderr.log"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent AppRotateFiles 1', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent AppExit Default Restart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'set BalanceAgent AppRestartDelay 5000', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          Exec(NSSMPath, 'start BalanceAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
          if ResultCode <> 0 then
            Exec(ExpandConstant('{sys}\sc.exe'), 'start BalanceAgent', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
        end;
      end;
    end;
  end;
end;
