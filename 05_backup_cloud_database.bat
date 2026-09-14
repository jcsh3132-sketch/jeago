@echo off
cd /d "%~dp0"
if not exist .env.migration.local (
  echo Missing .env.migration.local. Configure the database URL and token first.
  pause
  exit /b 1
)
node scripts/backup-database.mjs --env .env.migration.local
if errorlevel 1 (
  echo Backup failed. Do not use an unverified backup file.
  pause
  exit /b 1
)
echo Verified backup saved in work\backups. Copy it to your private backup storage.
pause
