<#
  Despliega AgroIoT desde tu PC (Windows) a la EC2 existente, sin GitHub en el servidor.

  Empaqueta el ultimo commit (git archive: .env, llaves y secrets.h NUNCA se incluyen), lo sube por scp
  a ~/agroiot y ejecuta scripts/setup_ec2.sh en la instancia. El .env del servidor se conserva.

  Uso (PowerShell, desde la raiz del repo):
      .\deploy\desplegar.ps1
      .\deploy\desplegar.ps1 -Ip 1.2.3.4          # si la IP publica cambio tras detener/iniciar la instancia
#>
param(
  [string]$Ip   = "32.193.138.160",                                   # <-- IP publica actual de tu EC2
  [string]$Key  = "C:\Users\Usuario\Downloads\llaves_servidor_final.pem",  # <-- tu llave .pem
  [string]$User = "ubuntu",
  [string]$Dir  = "agroiot"
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

if (-not (Test-Path $Key)) { throw "No encuentro la llave: $Key" }

# OpenSSH en Windows rechaza llaves con permisos abiertos ("UNPROTECTED PRIVATE KEY FILE")
icacls $Key /inheritance:r /grant:r "$($env:USERNAME):(R)" | Out-Null

if (git status --porcelain) {
  Write-Warning "Hay cambios sin commit: solo se despliega el ultimo commit. Haz 'git add -A; git commit' si quieres incluirlos."
}

$tar = "deploy\agroiot.tar.gz"
git archive --format=tar.gz -o $tar HEAD
Write-Host "Paquete creado: $tar ($([math]::Round((Get-Item $tar).Length/1KB)) KB)"

$ssh = @("-i", $Key, "-o", "StrictHostKeyChecking=accept-new", "-o", "ServerAliveInterval=30")
scp @ssh $tar "${User}@${Ip}:~/agroiot.tar.gz"
if ($LASTEXITCODE -ne 0) { throw "scp fallo (revisa IP, llave y que el puerto 22 este abierto)" }

$remoto = "mkdir -p ~/$Dir && tar -xzf ~/agroiot.tar.gz -C ~/$Dir && rm ~/agroiot.tar.gz && cd ~/$Dir && sudo bash scripts/setup_ec2.sh"
ssh @ssh "${User}@${Ip}" $remoto
$codigo = $LASTEXITCODE
Remove-Item $tar -ErrorAction SilentlyContinue
if ($codigo -ne 0) { Write-Warning "El setup termino con errores (codigo $codigo). Revisa la salida de arriba." }
else { Write-Host "`nListo: abre http://$Ip" -ForegroundColor Green }
