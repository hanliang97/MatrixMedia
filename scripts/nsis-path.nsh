!include "WinMessages.nsh"

!macro customInstall
  ; 安装后将应用安装目录加入当前用户 PATH，便于直接执行 `矩媒 cli ...`
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = ''Stop''; $$dir = [System.IO.Path]::GetFullPath(''$INSTDIR''); $$path = [Environment]::GetEnvironmentVariable(''Path'', ''User''); $$parts = @(); if (-not [string]::IsNullOrWhiteSpace($$path)) { $$parts = $$path -split ''\;'' | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -ne '''' } }; if ($$parts -notcontains $$dir) { $$parts += $$dir }; [Environment]::SetEnvironmentVariable(''Path'', ([string]::Join('';'', ($$parts | Select-Object -Unique))), ''User'')"'
  Pop $0

  ; 通知系统刷新环境变量（新开的终端可立即读取）
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i ${WM_SETTINGCHANGE}, p 0, w "Environment", i 0, i 5000, *p .r0)'

  ; 覆盖 installer 已创建的快捷方式，图标用 exe 旁 matrixmedia.ico 或 resources 下副本
  !ifndef BUILD_UNINSTALLER
  StrCpy $R9 ""
  IfFileExists "$INSTDIR\matrixmedia.ico" mmIcoRoot
  IfFileExists "$INSTDIR\resources\matrixmedia.ico" mmIcoRes
  Goto mmIcoChosen
  mmIcoRoot:
    StrCpy $R9 "$INSTDIR\matrixmedia.ico"
    Goto mmIcoChosen
  mmIcoRes:
    StrCpy $R9 "$INSTDIR\resources\matrixmedia.ico"
  mmIcoChosen:
  StrCmp $R9 "" mmAfterShortcuts

  ; 桌面快捷方式
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
  IfFileExists "$newDesktopLink" 0 mmAfterDesktopIcon
    CreateShortCut "$newDesktopLink" "$appExe" "" "$R9" 0
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  mmAfterDesktopIcon:
  !endif

  ; 开始菜单快捷方式（同样覆盖图标）
  IfFileExists "$newStartMenuLink" 0 mmAfterStartMenuIcon
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$R9" 0
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  mmAfterStartMenuIcon:

  mmAfterShortcuts:
  !endif
!macroend

!macro customUnInstall
  ; 卸载时从当前用户 PATH 中移除安装目录
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = ''Stop''; $$dir = [System.IO.Path]::GetFullPath(''$INSTDIR''); $$path = [Environment]::GetEnvironmentVariable(''Path'', ''User''); if ([string]::IsNullOrWhiteSpace($$path)) { exit 0 }; $$parts = $$path -split ''\;'' | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -ne '''' -and $$_ -ne $$dir }; [Environment]::SetEnvironmentVariable(''Path'', ([string]::Join('';'', ($$parts | Select-Object -Unique))), ''User'')"'
  Pop $0

  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i ${WM_SETTINGCHANGE}, p 0, w "Environment", i 0, i 5000, *p .r0)'
!macroend
