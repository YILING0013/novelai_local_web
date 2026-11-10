Unicode true
RequestExecutionLevel user
!include MUI2.nsh
!include LogicLib.nsh
!include x64.nsh
!include WordFunc.nsh
Name "NovelAI Local"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\NovelAI Local"
ShowInstDetails show
ShowUninstDetails show
SetCompressor /FINAL lzma
VIProductVersion "1.1.0.0"
VIAddVersionKey "ProductName" "NovelAI Local"
VIAddVersionKey "FileDescription" "NovelAI Local Windows x64 Installer"
VIAddVersionKey "FileVersion" "1.1.0"
VIAddVersionKey "LegalCopyright" "NovelAI Local contributors"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_FINISHPAGE_RUN "$INSTDIR\NovelAI Local.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\NovelAI.Local.Desktop"
!define WVKEY "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!macro CheckClosed
  System::Call 'kernel32::OpenMutexW(i 0x100000, i 0, w "Local\NovelAI.Local.Desktop.1") p.r0'
  ${If} $0 != 0
    System::Call 'kernel32::CloseHandle(p r0)'
    MessageBox MB_ICONEXCLAMATION|MB_OK "请先退出 NovelAI Local。Please close NovelAI Local." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "需要 Windows x64。Windows x64 is required." /SD IDOK
    Abort
  ${EndIf}
  !insertmacro CheckClosed
FunctionEnd
Function un.onInit
  !insertmacro CheckClosed
FunctionEnd

Section
  SetShellVarContext current
  SetRegView 32
  ReadRegStr $0 HKLM "${WVKEY}" "pv"
  ReadRegStr $1 HKCU "${WVKEY}" "pv"
  ${VersionCompare} "$0" "132.0.0.0" $2
  ${VersionCompare} "$1" "132.0.0.0" $3
  ${If} $2 == 2
  ${AndIf} $3 == 2
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    SetCompress off
    File /oname=webview2-runtime.exe "${WEBVIEW_RUNTIME}"
    SetCompress auto
    ExecWait '"$PLUGINSDIR\webview2-runtime.exe" /silent /install' $0
    ${If} $0 != 0
      MessageBox MB_ICONSTOP|MB_OK "WebView2 installation failed ($0)." /SD IDOK
      SetErrorLevel 3
      Abort
    ${EndIf}
  ${EndIf}
  SetRegView 64
  IfFileExists "$INSTDIR\Uninstall.exe" 0 install
  ExecWait '"$INSTDIR\Uninstall.exe" /S _?=$INSTDIR' $0
  ${If} $0 != 0
    Abort
  ${EndIf}
  install:
  SetOutPath "$INSTDIR"
  File /r "${PAYLOAD}\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\NovelAI Local.lnk" "$INSTDIR\NovelAI Local.exe"
  CreateShortcut "$DESKTOP\NovelAI Local.lnk" "$INSTDIR\NovelAI Local.exe"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "NovelAI Local"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "1.1.0"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\NovelAI Local.exe"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  SetRegView 64
  DeleteRegKey HKCU "${UNKEY}"
  Delete "$SMPROGRAMS\NovelAI Local.lnk"
  Delete "$DESKTOP\NovelAI Local.lnk"
  !include "${UNINSTALL_FILES}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
