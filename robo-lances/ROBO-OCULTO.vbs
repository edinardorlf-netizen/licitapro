' Liga o robô de lances do LicitaPro em segundo plano (sem janela preta).
' Chamado pelo Windows ao entrar e pelo vigia a cada 5 minutos (tarefa agendada).
' Se o robô já estiver rodando, a segunda cópia sai sozinha.
' Se alguém usou PARAR.bat (existe DESLIGADO.flag), não liga: use LIGAR.bat.
Set fso = CreateObject("Scripting.FileSystemObject")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(pasta & "\DESLIGADO.flag") Then WScript.Quit
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = pasta
sh.Run "cmd /c """ & pasta & "\INICIAR.bat""", 0, False
