' 사진대지 생성기 런처 (2026-08-13)
'
' 창을 하나도 띄우지 않고 서버를 시작한 뒤 브라우저만 연다.
'   - .bat으로 하면 cmd 창이 잠깐이라도 뜬다 -> WSH(.vbs)는 완전히 조용하다
'   - python.exe 대신 pythonw.exe: 콘솔이 없는 파이썬이라 검은 창이 생기지 않는다
' 서버 종료는 따로 할 필요가 없다 — 브라우저 창을 닫으면 app.py 워치독이 알아서 끈다.

Option Explicit

Dim sh, fso, base, url, i, alive
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
url  = "http://127.0.0.1:5183/"

' 이미 떠 있으면 그 서버를 그대로 쓴다 (창을 여러 개 열어도 서버는 하나)
If Not ServerUp(url) Then
    sh.CurrentDirectory = base
    ' 0 = 창 숨김, False = 끝날 때까지 기다리지 않음
    sh.Run "pythonw.exe app.py", 0, False

    ' 최대 20초까지 기다린다. 첫 실행은 파이썬이 모듈을 읽느라 몇 초 걸린다.
    alive = False
    For i = 1 To 40
        WScript.Sleep 500
        If ServerUp(url) Then
            alive = True
            Exit For
        End If
    Next

    If Not alive Then
        MsgBox "서버를 시작하지 못했습니다." & vbCrLf & vbCrLf & _
               "flask.log 파일을 확인해 주세요:" & vbCrLf & base & "\flask.log", _
               vbExclamation, "사진대지 생성기"
        WScript.Quit 1
    End If
End If

sh.Run url, 1, False

' 서버가 살아 있는지 확인. 안 떠 있으면 요청 자체가 실패하므로 오류를 잡아 False를 돌려준다.
Function ServerUp(addr)
    Dim http
    ServerUp = False
    On Error Resume Next
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", addr, False
    http.Send
    If Err.Number = 0 Then
        If http.Status >= 200 And http.Status < 500 Then ServerUp = True
    End If
    On Error GoTo 0
End Function
