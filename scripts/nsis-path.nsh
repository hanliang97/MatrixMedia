!include "WinMessages.nsh"

!macro customInstall
  ; 安装后将应用安装目录加入当前用户 PATH，便于直接执行 `矩媒 cli ...`
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = ''Stop''; $$dir = [System.IO.Path]::GetFullPath(''$INSTDIR''); $$path = [Environment]::GetEnvironmentVariable(''Path'', ''User''); $$parts = @(); if (-not [string]::IsNullOrWhiteSpace($$path)) { $$parts = $$path -split ''\;'' | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -ne '''' } }; if ($$parts -notcontains $$dir) { $$parts += $$dir }; [Environment]::SetEnvironmentVariable(''Path'', ([string]::Join('';'', ($$parts | Select-Object -Unique))), ''User'')"'
  Pop $0

  ; 通知系统刷新环境变量（新开的终端可立即读取）
  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i ${WM_SETTINGCHANGE}, p 0, w "Environment", i 0, i 5000, *p .r0)'

  ; 与 matrixmedia.exe 同目录的 matrixmedia.ico（extraFiles），快捷方式显式绑定，避免只认 resources\ 时找不到
  !ifndef BUILD_UNINSTALLER
  IfFileExists "$INSTDIR\matrixmedia.ico" mmWriteDesktopIcon
  Goto mmAfterDesktopIcon
  mmWriteDesktopIcon:
    CreateShortCut "$DESKTOP\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\matrixmedia.ico" 0
  mmAfterDesktopIcon:
  !endif
!macroend

!macro customUnInstall
  ; 卸载时从当前用户 PATH 中移除安装目录
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference = ''Stop''; $$dir = [System.IO.Path]::GetFullPath(''$INSTDIR''); $$path = [Environment]::GetEnvironmentVariable(''Path'', ''User''); if ([string]::IsNullOrWhiteSpace($$path)) { exit 0 }; $$parts = $$path -split ''\;'' | ForEach-Object { $$_.Trim() } | Where-Object { $$_ -ne '''' -and $$_ -ne $$dir }; [Environment]::SetEnvironmentVariable(''Path'', ([string]::Join('';'', ($$parts | Select-Object -Unique))), ''User'')"'
  Pop $0

  System::Call 'user32::SendMessageTimeoutW(p 0xffff, i ${WM_SETTINGCHANGE}, p 0, w "Environment", i 0, i 5000, *p .r0)'
!macroend
