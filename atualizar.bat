@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ==============================================================
echo   Transparencia Parauapebas - atualizacao local dos dados
echo ==============================================================
echo  [1] Incremental (ano atual e anterior)  - recomendado
echo  [2] Completo (todos os anos desde 2021)
set /p OPC="Escolha [1]: "
if "%OPC%"=="2" (python -m etl.pipeline --modo completo --limite-detalhes 20000 --limite-cnpj 3000) else (python -m etl.pipeline)
if errorlevel 1 (echo. & echo Houve erro na atualizacao. & pause & exit /b 1)
echo.
echo Abrindo o painel local em http://localhost:8000 ...
start "" http://localhost:8000
python -m http.server 8000 --directory site
