; Balance Agent Inno Setup installer
; Installe l’exécutable, configure SERIAL_PATH et propose l’installation en service via NSSM.

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
OutputDir=C:\symfony\terminal-agent-1.0\dist

[Files]
Source: "C:\symfony\terminal-agent-1.0\scripts\nssm.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "C:\symfony\terminal-agent-1.0\scripts\balance-agent.exe"; DestDir: "{app}"; Flags: ignoreversion
; Source: "C:\symfony\terminal-agent-1.0\scripts\nssm.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Balance Agent"; Filename: "{app}\balance-agent.exe"
Name: "{group}\Uninstall Balance Agent"; Filename: "{uninstallexe}"

[Run]
Filename: "{app}\balance-agent.exe"; Description: "Lancer Balance Agent"; Flags: nowait postinstall skipifsilent

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
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  PortVal: string;
  InstallSvc: Integer;
  ResultCode: Integer;
  NSSMPath: string;
  ExePath: string;
begin
  if CurStep = ssInstall then
  begin
    ExePath := ExpandConstant('{app}\balance-agent.exe');

    { --- Récupération du port série --- }
    PortVal := Trim(SerialPage.Values[0]);

    if PortVal <> '' then
    begin
      RegWriteStringValue(
        HKLM,
        'SYSTEM\CurrentControlSet\Control\Session Manager\Environment',
        'SERIAL_PATH',
        PortVal
      );
      BroadcastEnvironmentChange();
    end;

    { --- Installation en service via NSSM --- }
    InstallSvc := MsgBox(
      'Voulez-vous installer Balance Agent comme service Windows (NSSM requis) ?',
      mbConfirmation, MB_YESNO
    );

    if InstallSvc = IDYES then
    begin
      NSSMPath := ExpandConstant('{app}\nssm.exe');

      if FileExists(NSSMPath) then
      begin
        Exec(
          NSSMPath,
          'install "BalanceAgent" "' + ExePath + '"',
          '',
          SW_HIDE,
          ewWaitUntilTerminated,
          ResultCode
        );

        if ResultCode <> 0 then
          MsgBox('Échec de l’installation du service via NSSM (code: ' + IntToStr(ResultCode) + ')', mbError, MB_OK)
        else
          MsgBox('Service Windows "BalanceAgent" installé avec succès.', mbInformation, MB_OK);
      end
      else
      begin
        MsgBox(
          'nssm.exe est introuvable dans le dossier d''installation.'#13#10 +
          'Copiez nssm.exe dans {app} si vous souhaitez installer le service.',
          mbInformation, MB_OK
        );
      end;
    end;
  end;
end;