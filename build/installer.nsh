; Crystal Voice — кастомные шаги установщика

!macro customInstall
  ; Добавляем правила брандмауэра для Crystal Voice (исходящий и входящий трафик)
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Crystal Voice"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Crystal Voice" dir=out action=allow program="$INSTDIR\Crystal Voice.exe" enable=yes profile=any'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Crystal Voice" dir=in action=allow program="$INSTDIR\Crystal Voice.exe" enable=yes profile=any'
!macroend

!macro customUninstall
  ; Удаляем правила брандмауэра при деинсталляции
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Crystal Voice"'
!macroend
