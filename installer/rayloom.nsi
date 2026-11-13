; Silent self-extracting container. The user-facing setup is installer/electron.
Unicode True
RequestExecutionLevel user
Name "Rayloom"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Rayloom"
Icon "${ICONFILE}"
UninstallIcon "${ICONFILE}"
SetCompressor /SOLID lzma
SilentInstall silent
AutoCloseWindow true
ShowUninstDetails show

Var DataDir

Section "Rayloom"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\installer\payload"
 File /r "${RELEASE_ROOT}\*"
 SetOutPath "$PLUGINSDIR\installer\electron"
 File /r "${SOURCE_ROOT}\installer\electron\*"
 ExecWait '"$PLUGINSDIR\installer\payload\electron\electron.exe" "$PLUGINSDIR\installer\electron"' $0
 IfFileExists "$PLUGINSDIR\installer\install-result.ini" +2 0
  Abort
 ReadINIStr $INSTDIR "$PLUGINSDIR\installer\install-result.ini" "Rayloom" "InstallDir"
 ReadINIStr $DataDir "$PLUGINSDIR\installer\install-result.ini" "Rayloom" "DataDir"
 StrCmp $INSTDIR "" 0 +2
  Abort
 StrCmp $DataDir "" 0 +2
  Abort
 SetOutPath "$INSTDIR"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 CreateDirectory "$SMPROGRAMS\Rayloom"
 CreateShortcut "$SMPROGRAMS\Rayloom\Rayloom.lnk" "$INSTDIR\current\Rayloom.exe"
 CreateShortcut "$SMPROGRAMS\Rayloom\Удалить Rayloom.lnk" "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\Rayloom\Install" "Path" "$INSTDIR"
 WriteRegStr HKCU "Software\Rayloom\Install" "DataDir" "$DataDir"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayloom" "DisplayName" "Rayloom"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayloom" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayloom" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayloom" "Publisher" "Rayloom"
 WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayloom" "NoModify" 1
SectionEnd

Function un.onInit
 ReadRegStr $DataDir HKCU "Software\Rayloom\Install" "DataDir"
 StrCmp $DataDir "" 0 +2
  StrCpy $DataDir "$LOCALAPPDATA\Rayloom"
FunctionEnd

Section "Uninstall"
 ExecWait '"$INSTDIR\current\app\runtime\node\node.exe" "$INSTDIR\current\app\shared\install-release.mjs" --operation check-uninstall --install "$INSTDIR" --data "$DataDir"' $0
 StrCmp $0 "0" +3
  MessageBox MB_ICONSTOP "Сначала закройте Rayloom и фоновый движок. Профиль сохранён."
  Abort
 ExecWait '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\current\app\scripts\prepare-uninstall.ps1" -DataDir "$DataDir"' $0
 StrCmp $0 "0" +3
  MessageBox MB_ICONSTOP "Не удалось убрать автозапуск. Приложение оставлено без изменений."
  Abort
 ExecWait '"$INSTDIR\current\app\runtime\node\node.exe" "$INSTDIR\current\app\shared\install-release.mjs" --operation uninstall --install "$INSTDIR" --data "$DataDir"' $0
 StrCmp $0 "0" +3
  MessageBox MB_ICONSTOP "Сначала закройте Rayloom и фоновый движок. Профиль сохранён."
  Abort
 Delete "$SMPROGRAMS\Rayloom\Rayloom.lnk"
 Delete "$SMPROGRAMS\Rayloom\Удалить Rayloom.lnk"
 RMDir "$SMPROGRAMS\Rayloom"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Rayloom"
 DeleteRegKey HKCU "Software\Rayloom\Install"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
SectionEnd
