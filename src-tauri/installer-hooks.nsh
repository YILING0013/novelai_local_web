; 仅更新指向本次安装 EXE 的快捷方式，保留参数、工作目录及固定状态。
; 使用独立 ICO 路径，避免继续命中旧 EXE 图标引用。
!macro NAIRefreshShortcut shortcut
  !insertmacro IsShortcutTarget "${shortcut}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $3
  ${If} $3 = 1
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("${shortcut}", ${STGM_READWRITE})'
        ${IShellLink::SetIconLocation} $0 '(w "$INSTDIR\icons\icon.ico", 0)'
        ${IPersistFile::Save} $1 '("${shortcut}",1)'
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
    ; SHCNE_UPDATEITEM + SHCNF_PATHW：通知资源管理器重新读取这个快捷方式。
    System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x5, w "${shortcut}", p 0)'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $0
  Push $1
  Push $2
  Push $3
  Push $R8
  Push $R9
  !insertmacro NAIRefreshShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
  !if "${STARTMENUFOLDER}" != ""
    !insertmacro NAIRefreshShortcut "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !else
    !insertmacro NAIRefreshShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
  ; 固定到任务栏的副本也需更新；不新建、不取消固定，不改其他程序的快捷方式。
  FindFirst $R8 $R9 "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\*.lnk"
  ${DoWhile} $R9 != ""
    !insertmacro NAIRefreshShortcut "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\$R9"
    FindNext $R8 $R9
  ${Loop}
  FindClose $R8
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" '"$INSTDIR\icons\icon.ico",0'
  System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x5, w "$INSTDIR\${MAINBINARYNAME}.exe", p 0)'
  ; 按 Windows Shell 接口失效图标缓存，不删除缓存文件或重启资源管理器。
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
  Pop $R9
  Pop $R8
  Pop $3
  Pop $2
  Pop $1
  Pop $0
!macroend
