; "Open in Gen V1" File Explorer verbs, registered by the per-user NSIS
; installer. Everything here stays under HKCU; the install never elevates and
; never writes machine-wide registry hives. The opt-out marker is the DWORD
; value ExplorerIntegration
; under HKCU\Software\Gen V1: absent means default enabled, 1 explicitly
; enabled, 0 explicitly disabled. The in-app toggle mirrors this schema through
; reg.exe; keep key names, value names and command data identical in both.

!macro GenV1WriteExplorerVerbs
  WriteRegStr HKCU "Software\Classes\Directory\shell\GenV1" "" "Open in Gen V1"
  WriteRegStr HKCU "Software\Classes\Directory\shell\GenV1" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\shell\GenV1\DefaultIcon" "" '"$INSTDIR\Gen V1.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\GenV1\command" "" '"$INSTDIR\Gen V1.exe" --open-project "%V"'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GenV1" "" "Open in Gen V1"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GenV1" "MultiSelectModel" "Single"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GenV1\DefaultIcon" "" '"$INSTDIR\Gen V1.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\GenV1\command" "" '"$INSTDIR\Gen V1.exe" --open-project "%V"'
!macroend

!macro customInstall
  ; Register both verbs unless a recorded opt-out (marker value 0) survives.
  ; A missing or unreadable marker is the default-enabled state.
  ClearErrors
  ReadRegDWORD $R0 HKCU "Software\Gen V1" "ExplorerIntegration"
  ${if} ${errors}
    ClearErrors
    !insertmacro GenV1WriteExplorerVerbs
  ${elseif} $R0 != 0
    !insertmacro GenV1WriteExplorerVerbs
  ${endIf}
!macroend

!macro customUnInstall
  ; Own only the two GenV1 verb keys and the marker value. During an upgrade
  ; (--updated) the marker must survive so an explicit opt-out stays opted out
  ; when the new installer's customInstall runs.
  DeleteRegKey HKCU "Software\Classes\Directory\shell\GenV1"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\GenV1"
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Gen V1" "ExplorerIntegration"
  ${endIf}
  ClearErrors
!macroend
