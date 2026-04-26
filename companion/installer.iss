; Janitor Analytics — Inno Setup script
; Compile by opening this file in the Inno Setup Compiler (or via ISCC.exe).
; Output: installer-output\JanitorAnalytics-Setup.exe

#define MyAppName "Janitor Analytics"
#define MyAppVersion "1.0.5"
#define MyAppPublisher "Scandalari"
#define MyAppExeName "JanitorAnalytics.exe"

[Setup]
; AppId uniquely identifies this app to Windows. Never change it once shipped —
; doing so would make Windows treat upgrades as separate installs.
AppId={{dffe3f13-1061-45a2-8d51-8494261d77a9}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
OutputDir=installer-output
OutputBaseFilename=JanitorAnalytics-Setup
SetupIconFile=app.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Bundles everything from the PyInstaller dist folder. Must build the dist
; folder first via: python -m PyInstaller --noconfirm ... (see build commands).
Source: "dist\JanitorAnalytics\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
