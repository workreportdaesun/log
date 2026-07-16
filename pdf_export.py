"""생성된 xlsx를 로컬 설치된 Excel(COM 자동화)로 열어 PDF로 내보낸다.

주의: template.xlsx는 깨끗하게 새로 만든 파일이라 정상적으로 열린다(복구 불필요).
CorruptLoad(복구 모드)로 강제로 열면 Excel이 복구 과정에서 인쇄영역/페이지맞춤 설정을
누락시켜 PDF가 여러 페이지로 쪼개지는 문제가 있었다. 그래서 일반 Open을 사용한다.
"""
import os
import threading

import pythoncom
import win32com.client as win32

_lock = threading.Lock()  # Excel COM 인스턴스 동시 접근 방지


def xlsx_to_pdf(xlsx_path, pdf_path):
    xlsx_path = os.path.abspath(xlsx_path)
    pdf_path = os.path.abspath(pdf_path)
    with _lock:
        pythoncom.CoInitialize()
        try:
            excel = win32.gencache.EnsureDispatch("Excel.Application")
            excel.Visible = False
            excel.DisplayAlerts = False
            try:
                wb = excel.Workbooks.Open(xlsx_path)
                try:
                    wb.ExportAsFixedFormat(0, pdf_path)
                finally:
                    wb.Close(False)
            finally:
                excel.Quit()
        finally:
            pythoncom.CoUninitialize()
    return pdf_path
